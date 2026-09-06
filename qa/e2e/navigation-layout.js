"use strict";
/* global document, getComputedStyle */

const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join,resolve}=require("node:path");
const test=require("node:test");
const {chromium}=require("playwright");

const ROOT=join(__dirname,"..","..");
const read=(path)=>readFileSync(join(ROOT,path),"utf8");
const sharedCss=`${read("public/styles/product-nav.css")}\n${read("public/styles/experience.css")}`;

function headerFrom(path){
  const match=read(path).match(/<header\b[\s\S]*?<\/header>/i);
  assert.ok(match,`${path} must contain a header`);
  return match[0];
}

test("account and setup navigation fit narrow screens with touch-sized targets",{timeout:30_000},async()=>{
  const options={headless:true};
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  const browser=await chromium.launch(options);
  try{
    const fixtures=[
      {name:"account",header:headerFrom("public/pages/account.html"),css:`${read("public/styles/account.css")}\n${sharedCss}`,current:"Account"},
      {name:"setup",header:headerFrom("public/pages/onboarding.html"),css:`${read("public/styles/onboarding.css")}\n${sharedCss}`,current:null}
    ];
    for(const width of [320,390])for(const fixture of fixtures){
      const page=await browser.newPage({viewport:{width,height:700}});
      await page.setContent(`<style>${fixture.css}</style>${fixture.header}`);
      const result=await page.evaluate(()=>({
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        links:[...document.querySelectorAll(".product-nav a")].map(link=>({text:link.textContent.trim(),width:link.getBoundingClientRect().width,height:link.getBoundingClientRect().height,fontSize:parseFloat(getComputedStyle(link).fontSize)})),
        current:document.querySelector('.product-nav [aria-current="page"]')?.textContent.trim()||null
      }));
      assert.ok(result.overflow<=1,`${fixture.name} navigation overflows ${width}px by ${result.overflow}px`);
      assert.deepEqual(result.links.map(link=>link.text),["Rankings","Strata+","Plan","Train","Account"]);
      assert.ok(result.links.every(link=>link.width>=44&&link.height>=44),`${fixture.name} navigation must keep 44×44px targets at ${width}px`);
      assert.ok(result.links.every(link=>link.fontSize>=11),`${fixture.name} navigation text must remain readable at ${width}px`);
      assert.equal(result.current,fixture.current);
      await page.close();
    }
  }finally{await browser.close();}
});

test("responsive product headers follow their visual keyboard order",{timeout:30_000},async()=>{
  const options={headless:true};
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  const browser=await chromium.launch(options);
  try{
    const fixtures=[
      {
        name:"Strata+",header:headerFrom("public/pages/discover.html"),css:read("public/styles/discover.css"),bodyClass:"plus-studio",
        desktop:["STRATA home","Rankings","Strata+","Plan","Train","Account","Sign out"],
        mobile:["STRATA home","Account","Sign out","Rankings","Strata+","Plan","Train"]
      },
      {
        name:"Plan",header:headerFrom("public/pages/planner.html"),css:read("public/styles/planner.css"),signedIn:true,
        desktop:["STRATA rankings","Rankings","Strata+","Plan","Train","Account","Sign out"],
        mobile:["STRATA rankings","Account","Sign out","Rankings","Strata+","Plan","Train"]
      },
      {
        name:"Train",header:headerFrom("public/pages/workout.html"),css:read("public/styles/workout.css"),
        desktop:["STRATA rankings","Rankings","Strata+","Plan","Train","Account"],
        mobile:["STRATA rankings","Account","Rankings","Strata+","Plan","Train"]
      }
    ];
    for(const fixture of fixtures)for(const [width,expected] of [[1200,fixture.desktop],[390,fixture.mobile],[320,fixture.mobile]]){
      const page=await browser.newPage({viewport:{width,height:800}});
      await page.setContent(`<style>${fixture.css}</style>${fixture.header}`);
      if(fixture.bodyClass)await page.evaluate((bodyClass)=>{document.body.className=bodyClass;},fixture.bodyClass);
      if(fixture.signedIn)await page.evaluate(()=>{document.getElementById("userName").hidden=false;document.getElementById("logoutButton").hidden=false;});
      const result=await page.evaluate(()=>{
        const controls=[...document.querySelectorAll("header a,header button")].filter((control)=>{
          const style=getComputedStyle(control),rect=control.getBoundingClientRect();
          return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0&&!control.disabled;
        });
        controls.forEach((control,index)=>{control.dataset.focusOrder=String(index);});
        document.body.tabIndex=-1;document.body.focus();
        return {
          labels:controls.map((control)=>(control.getAttribute("aria-label")||control.textContent||"").replace(/\s+/g," ").trim()),
          targets:controls.map((control)=>{const rect=control.getBoundingClientRect();return{width:rect.width,height:rect.height};}),
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
        };
      });
      const keyboard=[];
      for(let index=0;index<expected.length;index++){
        await page.keyboard.press("Tab");
        keyboard.push(await page.evaluate(()=>Number(document.activeElement?.dataset.focusOrder)));
      }
      assert.deepEqual(result.labels,expected,`${fixture.name} visible controls must follow visual order at ${width}px`);
      assert.deepEqual(keyboard,expected.map((_,index)=>index),`${fixture.name} Tab order must follow its visible controls at ${width}px`);
      assert.ok(result.targets.every(({width:targetWidth,height})=>targetWidth>=44&&height>=44),`${fixture.name} header targets must remain at least 44×44px at ${width}px`);
      assert.ok(result.overflow<=1,`${fixture.name} header overflows ${width}px by ${result.overflow}px`);
      await page.close();
    }
  }finally{await browser.close();}
});
