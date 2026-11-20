'use strict';

const fs=require('fs');
const path=require('path');

const inputFiles=process.argv.slice(2).filter(argument=>!argument.startsWith('--'));
const outputArgument=process.argv.find(argument=>argument.startsWith('--out='));
const outputPath=path.resolve(outputArgument?outputArgument.slice(6):'ai/trained_weights.json');
if(!inputFiles.length){
    console.error('Usage: node ai/tune_weights.js <AI log.json> [more logs...] [--out=ai/trained_weights.json]');
    process.exit(1);
}

const values={jiang:1200,che:110,pao:100,ma:95,xiang:90,shi:75,bing:85,fang:105,zhan:120,zhi:105,tietai:70,dujie:65};
const weights={capture:1.05,generalCapture:5000,progress:7,safety:5,production:0.28,barracks:42,load:18,unload:13,activate:7,deploy:12,bridge:24,flight:1,random:2.5};
const trainable=['capture','progress','safety','production','barracks','load','unload','activate','deploy','bridge','flight'];

function features(action={}){
    const result=Object.fromEntries(trainable.map(name=>[name,0]));
    if(['attack','moveCapture','shipFire'].includes(action.type)) result.capture=(values[action.targetType]||50)/120;
    if(action.type==='selfDestruct') result.capture=(Number(action.captureValue)||0)/120;
    if(action.type==='move'||action.type==='unload'||action.type==='bridge') result.progress=(Number(action.progress)||0)/8;
    if(action.type==='move') result.safety=(Number(action.safety)||0)/4;
    if(['produce','airProduce','attachParasite'].includes(action.type)) result.production=(values[action.produceType]||50)/120;
    if(action.type==='placeBarracks') result.barracks=1;
    if(action.type==='load') result.load=1;
    if(action.type==='unload') result.unload=1;
    if(action.type==='activate') result.activate=1;
    if(action.type==='deploy') result.deploy=1;
    if(action.type==='bridge') result.bridge=1;
    if(action.type==='flightRoute') result.flight=(Number(action.routeScore)||0)/180;
    return result;
}

function averageFeature(actions){
    const result=features();
    if(!actions.length) return result;
    actions.forEach(action=>{ const current=features(action); trainable.forEach(name=>{ result[name]+=current[name]/actions.length; }); });
    return result;
}

const matches=[];
for(const file of inputFiles){
    const payload=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
    const gameEnd=[...(payload.logs||[])].reverse().find(entry=>entry.type==='game_end');
    const winner=gameEnd?.result?.winner||gameEnd?.result?.result?.winner||null;
    if(!winner) continue;
    matches.push({winner,records:(payload.records||[]).filter(record=>record.accepted&&record.chosen)});
}

if(!matches.length){
    console.error('No completed match with a winner was found in the supplied logs.');
    process.exit(2);
}

const learningRate=0.18;
for(let epoch=0;epoch<24;epoch++){
    matches.forEach(match=>match.records.forEach(record=>{
        const reward=record.player===match.winner?1:-0.22;
        const chosen=features(record.chosen), baseline=averageFeature(record.legalActions||[]);
        trainable.forEach(name=>{ weights[name]+=learningRate*reward*(chosen[name]-baseline[name]); });
    }));
}

weights.capture=Math.max(0.1,weights.capture);
weights.progress=Math.max(0,weights.progress);
weights.safety=Math.max(0,weights.safety);
weights.production=Math.max(0.05,weights.production);
weights.random=Math.max(0.2,Math.min(4,weights.random));
Object.keys(weights).forEach(name=>{ weights[name]=Number(weights[name].toFixed(4)); });

const output={protocol:'chess-barracks-ai-weights/v1',trainedAt:new Date().toISOString(),matches:matches.length,samples:matches.reduce((sum,match)=>sum+match.records.length,0),weights};
fs.writeFileSync(outputPath,JSON.stringify(output,null,2));
console.log(`Saved ${output.samples} samples from ${output.matches} matches to ${outputPath}`);
