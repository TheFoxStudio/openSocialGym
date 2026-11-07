#!/usr/bin/env node
// Run in a disposable release checkout before cap sync / the iOS target generators.
import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
export function configureIos(root,bundleId,buildNumber){
 if(!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+){2,}$/.test(bundleId)||bundleId.startsWith('ch.opengym.')||bundleId.startsWith('ch.duartesantos.'))throw Error('Use your own registered reverse-DNS bundle ID.');
 if(!/^[1-9]\d{0,8}$/.test(String(buildNumber)))throw Error('Use a positive integer build number.');
 const front=path.join(root,'frontend'),ios=path.join(front,'ios'),version=JSON.parse(fs.readFileSync(path.join(front,'package.json'),'utf8')).version;
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(['Pods','build','public','.git','DerivedData'].includes(entry.name)||entry.isSymbolicLink())continue;
  const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue}
  if(!/\.(swift|plist|entitlements|pbxproj|rb|strings)$/.test(entry.name))continue;
  const original=fs.readFileSync(file,'utf8');let text=original.replaceAll('ch.opengym.app',bundleId);
  if(entry.name==='Info.plist')text=text.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)openGym/g,'$1openSocialGym');
  if(entry.name==='InfoPlist.strings')text=text.replaceAll('openGym','openSocialGym');
  if(entry.name==='project.pbxproj')text=text.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g,'CURRENT_PROJECT_VERSION = '+buildNumber+';').replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = '+version+';');
  if(text!==original)fs.writeFileSync(file,text);
 }};walk(ios);
 const configPath=path.join(front,'capacitor.config.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));config.appId=bundleId;config.appName='openSocialGym';fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
 return{bundleId,appGroup:'group.'+bundleId,version,buildNumber:String(buildNumber)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(configureIos(process.cwd(),process.argv[2],process.argv[3]),null,2));
