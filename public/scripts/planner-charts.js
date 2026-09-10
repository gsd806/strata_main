/* global module, require */
(function(root,factory){
  const core=typeof module==="object"&&module.exports?require("./particle-chart-core"):root.StrataParticleChart;
  const api=factory(core);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataPlannerCharts=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(Chart){
  "use strict";

  const MAX_MUSCLES=8;
  function muscleSeries(entries){
    return(Array.isArray(entries)?entries:[]).slice(0,MAX_MUSCLES).flatMap((entry)=>{
      const label=String(entry?.label||"").trim(),sets=Number(entry?.sets);
      return label&&Number.isFinite(sets)&&sets>0?[{label,sets}]:[];
    });
  }
  function createMuscleChart({host,shell,library=globalThis.ParticleCharts,reducedMotion=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true}={}){
    let instance=null;
    function destroy(){instance=Chart?.destroy?Chart.destroy(instance,host):null;if(host)host.hidden=true;if(shell)shell.hidden=true;}
    function render(entries){
      const muscles=muscleSeries(entries);
      if(!muscles.length||!Chart?.options||!Chart?.upsert){destroy();return{muscles,rendered:false};}
      const data={labels:muscles.map(({label})=>label),series:[{name:"Primary muscle sets",data:muscles.map(({sets})=>sets),color:Chart.ACCENT||"#9fce32"}]};
      const chartOptions=Chart.options({unit:"sets",reducedMotion:reducedMotion(),type:"bar",theme:"dark",horizontal:true,showValues:false});
      if(host)host.hidden=false;if(shell)shell.hidden=false;
      instance=Chart.upsert(instance,host,data,chartOptions,library);
      const rendered=Boolean(instance);if(host)host.hidden=!rendered;if(shell)shell.hidden=!rendered;
      return{muscles,data,options:chartOptions,rendered};
    }
    function resize(){return Chart?.resize?.(instance)||false;}
    return{destroy,render,resize};
  }

  return{MAX_MUSCLES,createMuscleChart,muscleSeries};
});
