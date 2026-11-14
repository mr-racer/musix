// Smoke: the round 2 file opens without page errors.
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {dirname,resolve} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const b=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});const errors=[];
const p=await b.newPage({viewport:{width:412,height:915}});p.on('pageerror',e=>errors.push(e.message));
await p.goto('file://'+resolve(here,'out/android-home-r2.html'));await p.waitForTimeout(800);await b.close();
if(errors.length){console.log('FAIL',errors);process.exit(1);}console.log('PASS: r2 opens clean');
