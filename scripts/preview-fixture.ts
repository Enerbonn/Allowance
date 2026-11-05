/** Read-only, in-memory visual fixture; never loads the user's local ledger. */
import express from 'express';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {setAccessCode} from '../server/workspace.ts';
import {resolve} from 'node:path';
const store=new Store(':memory:');setAccessCode(store,'maya','fixture-private-code');
const maya=store.get<any>('people','maya');maya.description='Creates the launch identity and approved campaign artwork. Purchases licensed fonts, imagery and design tools for assigned work.';maya.budget=1500000000;store.put('people','maya',maya);
store.setSetting('access-v2','enabled');const token=store.session('owner');const host=express();host.use((req,res,next)=>{if(!['GET','HEAD'].includes(req.method)||req.path.startsWith('/api/testnet'))return res.status(403).json({error:'Read-only visual fixture.'});res.cookie('allowance_session',token,{httpOnly:true,sameSite:'strict'});next();});host.use(createApp(store));host.use(express.static(resolve('dist')));host.use((_req,res)=>res.sendFile(resolve('dist/index.html')));host.listen(4312,'127.0.0.1',()=>console.log('Read-only synthetic visual fixture: http://127.0.0.1:4312'));
