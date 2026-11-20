(function(global){
    'use strict';

    const PIECE_VALUES=Object.freeze({
        jiang:1200,che:110,pao:100,ma:95,xiang:90,shi:75,bing:85,
        fang:105,zhan:120,zhi:105,tietai:70,dujie:65
    });
    const DEFAULT_WEIGHTS=Object.freeze({
        capture:1.08, generalCapture:5000, exchange:0.42, progress:7, safety:6,
        production:0.3, productionNeed:1, barracks:38, load:16, unload:12,
        activate:6, deploy:11, bridge:18, flight:1, landing:32, crash:-80, random:2.5,
        offense:2.4, frontline:1.2, support:1.4, airAttack:2.4, airTransfer:1.5,
        homeDefense:1.1, barracksForward:1.35, barracksSpacing:1.1, airObjective:1.4, loop:-160
    });
    const DIFFICULTY_PROFILES=Object.freeze({
        easy:Object.freeze({candidatePool:10,scoreWindow:90,noise:15,tactics:0.72,safety:0.45,economy:0.72,planning:0.55}),
        normal:Object.freeze({candidatePool:3,scoreWindow:24,noise:2.5,tactics:1,safety:1,economy:1,planning:1}),
        hard:Object.freeze({candidatePool:1,scoreWindow:0,noise:0.15,tactics:1.28,safety:1.35,economy:1.18,planning:1.32})
    });

    function hashSeed(value){
        let hash=2166136261;
        for(const char of String(value||'chess-barracks-ai')){
            hash^=char.charCodeAt(0);
            hash=Math.imul(hash,16777619);
        }
        return hash>>>0;
    }

    class SeededRandom{
        constructor(seed){ this.state=hashSeed(seed)||0x9e3779b9; }
        next(){
            let value=this.state+=0x6d2b79f5;
            value=Math.imul(value^(value>>>15),value|1);
            value^=value+Math.imul(value^(value>>>7),value|61);
            return ((value^(value>>>14))>>>0)/4294967296;
        }
        pick(items){ return items.length?items[Math.floor(this.next()*items.length)]:null; }
    }

    function valueOf(type){ return PIECE_VALUES[type]||50; }

    class RuleBasedAI{
        constructor(options={}){
            this.kind='rule';
            this.name=options.name||'正规AI';
            this.difficulty=DIFFICULTY_PROFILES[options.difficulty]?options.difficulty:'normal';
            this.profile=DIFFICULTY_PROFILES[this.difficulty];
            this.random=new SeededRandom(options.seed||this.name);
            this.weights={...DEFAULT_WEIGHTS,...(options.weights||{})};
        }
        scoreAction(action){
            const weights=this.weights, profile=this.profile;
            let score=Number(action.baseScore)||0;
            switch(action.type){
                case 'attack':
                case 'moveCapture':
                    score+=(action.targetType==='jiang'?weights.generalCapture:valueOf(action.targetType)*weights.capture*profile.tactics);
                    score+=(valueOf(action.targetType)-valueOf(action.pieceType))*weights.exchange*profile.tactics;
                    score-=Math.max(0,Number(action.risk)||0)*weights.safety*profile.safety;
                    if(action.pieceType==='jiang'&&action.targetType!=='jiang') score-=70*profile.safety;
                    break;
                case 'shipFire':
                    score+=(action.targetType==='jiang'?weights.generalCapture:valueOf(action.targetType)*weights.capture*profile.tactics);
                    score-=valueOf(action.projectileType)*0.68*profile.safety;
                    break;
                case 'selfDestruct':
                    score+=(Number(action.captureValue)||0)*weights.capture*profile.tactics-valueOf(action.pieceType)*0.78*profile.safety;
                    break;
                case 'move':
                case 'landBridge':
                    score+=(Number(action.progress)||0)*weights.progress*profile.planning+(Number(action.safety)||0)*weights.safety*profile.safety;
                    score+=(Number(action.objectiveBonus)||0)*profile.planning;
                    score+=(Number(action.forwardScore)||0)*weights.frontline*0.45*profile.planning;
                    score+=(Number(action.forwardGain)||0)*weights.frontline*profile.planning;
                    score+=(Number(action.supportScore)||0)*weights.support*profile.planning;
                    score-=Math.max(0,Number(action.danger)||0)*weights.safety*profile.safety;
                    break;
                case 'produce':
                case 'airProduce':
                case 'attachParasite':
                    score+=valueOf(action.produceType)*weights.production*profile.economy;
                    score+=(Number(action.needBonus)||0)*weights.productionNeed*profile.economy;
                    score+=(Number(action.defenseBonus)||0)*profile.safety;
                    score+=(Number(action.frontlineScore)||0)*weights.frontline*0.35*profile.planning;
                    score+=(Number(action.attackNeed)||0)*weights.offense*profile.tactics;
                    score+=(Number(action.airPlatformScore)||0)*weights.airTransfer*0.45*profile.planning;
                    score+=(Number(action.supportScore)||0)*weights.support*0.35*profile.planning;
                    break;
                case 'placeBarracks':
                    score+=weights.barracks*profile.economy+(Number(action.needBonus)||0)*profile.planning;
                    score+=(Number(action.safety)||0)*weights.safety*profile.safety;
                    score+=(Number(action.frontlineScore)||0)*weights.frontline*profile.planning;
                    score+=(Number(action.forwardGain)||0)*weights.barracksForward*profile.planning;
                    score+=(Number(action.coverScore)||0)*weights.support*profile.planning;
                    score+=(Number(action.enemyPressure)||0)*weights.offense*profile.tactics;
                    score+=(Number(action.homeDefense)||0)*weights.homeDefense*profile.safety;
                    score-=Math.max(0,Number(action.rearPenalty)||0)*weights.homeDefense*profile.safety;
                    score-=Math.max(0,Number(action.barracksSpacingPenalty)||0)*weights.barracksSpacing*profile.planning;
                    break;
                case 'load': score+=weights.load*profile.planning+(Number(action.needBonus)||0); break;
                case 'unload':
                    score+=weights.unload*profile.planning+(Number(action.progress)||0)*weights.progress*profile.planning;
                    score+=(Number(action.safety)||0)*weights.safety*profile.safety;
                    break;
                case 'activate': score+=weights.activate+(Number(action.needBonus)||0); break;
                case 'deploy': score+=weights.deploy+(Number(action.nearbyEnemies)||0)*16*profile.tactics; break;
                case 'bridge': score+=weights.bridge*profile.planning+(Number(action.progress)||0)*weights.progress*profile.planning; break;
                case 'flightRoute':
                    score+=(Number(action.routeScore)||0)*weights.flight*profile.tactics;
                    score+=action.willLand?weights.landing*profile.planning:weights.crash*profile.safety;
                    score+=(Number(action.airAttackValue)||0)*weights.airAttack*profile.tactics;
                    score+=(Number(action.landingScore)||0)*weights.airTransfer*profile.planning;
                    score+=(Number(action.forwardTransfer)||0)*weights.frontline*0.9*profile.planning;
                    score+=(Number(action.routeObjective)||0)*weights.airObjective*profile.planning;
                    if(action.sourceReturn) score+=weights.loop*profile.planning;
                    break;
                default: score+=1;
            }
            score+=Number(action.intentBonus)||0;
            score+=(Number(action.strategicScore)||0)*profile.planning;
            const randomScale=Math.max(0,Number(profile.noise??weights.random));
            return score+(this.random.next()-0.5)*randomScale;
        }
        async chooseAction(context){
            const actions=Array.isArray(context.actions)?context.actions:[];
            if(!actions.length) return null;
            const ranked=actions.map(action=>({action,score:this.scoreAction(action)})).sort((a,b)=>b.score-a.score);
            if(this.profile.candidatePool<=1) return ranked[0].action;
            const best=ranked[0].score;
            const pool=ranked
                .filter(item=>item.score>=best-this.profile.scoreWindow)
                .slice(0,Math.min(this.profile.candidatePool,ranked.length));
            return this.random.pick(pool.length?pool:ranked.slice(0,1)).action;
        }
        async chooseFallback(context){ return this.chooseAction(context); }
    }

    class ExternalAIAdapter{
        constructor(options={}){
            this.kind='external';
            this.name=options.name||'外部AI';
            this.endpoint=String(options.endpoint||'').trim();
            this.timeoutMs=Math.max(1000,Number(options.timeoutMs)||12000);
            this.fallback=new RuleBasedAI({...options,name:'外部AI离线后备'});
        }
        async chooseAction(context){
            if(!this.endpoint) return this.fallback.chooseAction(context);
            const controller=new AbortController();
            const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
            try{
                const response=await fetch(this.endpoint,{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        protocol:'chess-barracks-ai/v1',
                        player:context.player,
                        state:context.state,
                        legalActions:context.actions,
                        requestId:context.requestId
                    }),
                    signal:controller.signal
                });
                if(!response.ok) throw new Error('HTTP '+response.status);
                const payload=await response.json();
                return payload?.action||payload||null;
            }catch(error){
                if(typeof context.onExternalError==='function') context.onExternalError(error);
                return this.fallback.chooseAction(context);
            }finally{
                clearTimeout(timer);
            }
        }
        async chooseFallback(context){ return this.fallback.chooseAction(context); }
    }

    function createController(spec={}){
        const type=typeof spec==='string'?spec:(spec.type||spec.controller||'human');
        const options=typeof spec==='string'?{}:spec;
        if(type==='external') return new ExternalAIAdapter(options);
        if(type==='rule'||type==='ai') return new RuleBasedAI(options);
        return null;
    }

    function controllerLabel(type){
        return ({human:'真人',rule:'正规AI',ai:'正规AI',external:'外部AI'})[type]||type;
    }

    global.ChessBarracksAI=Object.freeze({
        version:'1.1.0',
        protocol:'chess-barracks-ai/v1',
        RuleBasedAI,
        ExternalAIAdapter,
        SeededRandom,
        createController,
        controllerLabel,
        defaultWeights:{...DEFAULT_WEIGHTS},
        difficultyProfiles:DIFFICULTY_PROFILES,
        pieceValues:{...PIECE_VALUES}
    });
})(typeof window!=='undefined'?window:globalThis);
