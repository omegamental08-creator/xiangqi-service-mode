'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
require('./chess_barracks_ai.js');

const AI=globalThis.ChessBarracksAI;

async function run(){
    assert(AI,'AI module should expose ChessBarracksAI');

    const first=new AI.SeededRandom('same-seed');
    const second=new AI.SeededRandom('same-seed');
    assert.deepStrictEqual([first.next(),first.next(),first.next()],[second.next(),second.next(),second.next()]);

    const rule=new AI.RuleBasedAI({seed:'rule-test',difficulty:'hard'});
    const chosen=await rule.chooseAction({actions:[
        {id:'move',type:'move',progress:2},
        {id:'capture-rook',type:'attack',targetType:'che'},
        {id:'capture-general',type:'attack',targetType:'jiang'}
    ]});
    assert.strictEqual(chosen.id,'capture-general');

    const forwardBarracks=rule.scoreAction({type:'placeBarracks',frontlineScore:90,coverScore:18,enemyPressure:2,homeDefense:0,needBonus:20});
    const homeBarracks=rule.scoreAction({type:'placeBarracks',frontlineScore:10,coverScore:0,enemyPressure:0,homeDefense:-28,needBonus:0});
    assert(forwardBarracks>homeBarracks,'forward barracks should outrank a second rear barracks');
    const spacedBarracks=rule.scoreAction({type:'placeBarracks',frontlineScore:72,forwardGain:36,coverScore:10,enemyPressure:2,homeDefense:0,rearPenalty:0,barracksSpacingPenalty:0});
    const crowdedBarracks=rule.scoreAction({type:'placeBarracks',frontlineScore:72,forwardGain:36,coverScore:10,enemyPressure:2,homeDefense:0,rearPenalty:0,barracksSpacingPenalty:6});
    assert(spacedBarracks>crowdedBarracks,'forward barracks should avoid stacking on an existing barracks');

    const forwardFlight=rule.scoreAction({type:'flightRoute',routeScore:80,willLand:true,airAttackValue:110,landingScore:60,forwardTransfer:45,sourceReturn:false});
    const loopingFlight=rule.scoreAction({type:'flightRoute',routeScore:80,willLand:true,airAttackValue:0,routeObjective:-220,landingScore:0,forwardTransfer:0,sourceReturn:true});
    assert(forwardFlight>loopingFlight,'an attacking forward flight should outrank a same-platform loop');
    const usefulTransfer=rule.scoreAction({type:'flightRoute',routeScore:35,willLand:true,airAttackValue:0,routeObjective:40,landingScore:45,forwardTransfer:32,sourceReturn:false});
    assert(usefulTransfer>loopingFlight,'a forward transfer should outrank an empty return flight');

    const tester=new AI.TestAI({seed:'test-probe',invalidRate:0.9});
    tester.invalidRate=1;
    const probe=await tester.chooseAction({player:'A',state:{pieces:[]},actions:[{id:'legal',type:'move'}]});
    assert(probe.probe,'test AI should emit a named invalid probe');

    const external=new AI.ExternalAIAdapter({endpoint:'',seed:'offline'});
    const fallback=await external.chooseAction({actions:[{id:'only-action',type:'move'}]});
    assert.strictEqual(fallback.id,'only-action');

    const externalTester=new AI.ExternalAIAdapter({type:'external-test',endpoint:'',invalidRate:0.9,seed:'external-test'});
    externalTester.testProbeRate=1;
    const externalProbe=await externalTester.chooseAction({player:'A',state:{pieces:[]},actions:[{id:'legal',type:'move'}]});
    assert(externalProbe.probe,'external test AI should emit an invalid probe');

    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chess-barracks-ai-test-'));
    try{
        const logFile=path.join(temporary,'match.json');
        const weightsFile=path.join(temporary,'weights.json');
        fs.writeFileSync(logFile,JSON.stringify({
            logs:[{type:'game_end',result:{winner:'A'}}],
            records:[{player:'A',accepted:true,chosen:{type:'attack',targetType:'che'},legalActions:[{type:'attack',targetType:'che'},{type:'move',progress:2}]}]
        }));
        const training=spawnSync(process.execPath,[path.join(__dirname,'tune_weights.js'),logFile,'--out='+weightsFile],{encoding:'utf8'});
        assert.strictEqual(training.status,0,training.stderr);
        const output=JSON.parse(fs.readFileSync(weightsFile,'utf8'));
        assert.strictEqual(output.samples,1);
        assert(output.weights.capture>1.05,'winning captures should increase the capture weight');
    }finally{
        fs.rmSync(temporary,{recursive:true,force:true});
    }

    console.log('AI module tests passed');
}

run().catch(error=>{
    console.error(error);
    process.exitCode=1;
});
