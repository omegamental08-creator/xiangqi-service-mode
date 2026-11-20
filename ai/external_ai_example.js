'use strict';

const http=require('http');

const host=process.env.AI_HOST||'127.0.0.1';
const port=Number(process.env.AI_PORT)||8091;
const pieceValues={jiang:1200,che:110,pao:100,ma:95,xiang:90,shi:75,bing:85,fang:105,zhan:120,zhi:105,tietai:70,dujie:65};

function score(action){
    let value=Number(action.baseScore)||0;
    if(['attack','moveCapture','shipFire'].includes(action.type)) value+=pieceValues[action.targetType]||50;
    if(action.targetType==='jiang') value+=5000;
    if(action.type==='selfDestruct') value+=Number(action.captureValue)||0;
    if(action.type==='placeBarracks') value+=38;
    if(action.type==='produce'||action.type==='airProduce') value+=(pieceValues[action.produceType]||50)*0.25;
    if(action.type==='flightRoute') value+=Number(action.routeScore)||0;
    value+=(Number(action.progress)||0)*5+(Number(action.safety)||0)*4;
    return value+Math.random()*1.5;
}

function reply(response,status,payload){
    response.writeHead(status,{
        'Content-Type':'application/json; charset=utf-8',
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Headers':'Content-Type',
        'Access-Control-Allow-Methods':'POST,OPTIONS'
    });
    response.end(JSON.stringify(payload));
}

const server=http.createServer((request,response)=>{
    if(request.method==='OPTIONS') return reply(response,204,{});
    if(request.method!=='POST'||request.url!=='/move') return reply(response,404,{error:'Use POST /move'});
    let body='';
    request.on('data',chunk=>{
        body+=chunk;
        if(body.length>8*1024*1024) request.destroy();
    });
    request.on('end',()=>{
        try{
            const payload=JSON.parse(body||'{}');
            if(payload.protocol!=='chess-barracks-ai/v1') return reply(response,400,{error:'Unsupported protocol'});
            const actions=Array.isArray(payload.legalActions)?payload.legalActions:[];
            if(!actions.length) return reply(response,200,{action:null});
            actions.sort((left,right)=>score(right)-score(left));
            reply(response,200,{action:{id:actions[0].id},requestId:payload.requestId});
        }catch(error){
            reply(response,400,{error:error.message});
        }
    });
});

server.on('error',error=>{
    console.error('External AI server failed:',error.message);
    process.exitCode=1;
});

server.listen(port,host,()=>{
    console.log(`Chess Barracks external AI: http://${host}:${port}/move`);
});
