/* global module, require */
(function(root,factory){
  "use strict";
  const particles=typeof module==="object"&&module.exports?require("./particle-chart-core"):root.StrataParticleChart;
  const chart=factory(particles);
  if(typeof module==="object"&&module.exports)module.exports=chart;
  else root.StrataWorkoutChart=chart;
})(typeof globalThis!=="undefined"?globalThis:this,function(Particles){
  "use strict";
  const MEASUREMENTS=new Set(["reps","timed"]),LOAD_TYPES=new Set(["external","bodyweight","assisted"]),UNITS=new Set(["kg","lb"]);

  function create({$,state,workout:W,exercise,formatLabel,esc,number,library=globalThis.ParticleCharts,reducedMotion=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true}){
    if(!Particles?.options||!Particles?.upsert||!Particles?.destroy)throw new Error("The shared STRATA chart core did not load.");
    let chart=null;
    const host=()=>$("performanceChartCanvas");
    function validPoint(point){
      const startedAt=Number(point?.startedAt),date=String(point?.date||"");
      if(!Number.isFinite(startedAt)||startedAt<=0||!/^\d{4}-\d{2}-\d{2}$/u.test(date))return false;
      const parsed=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===date;
    }
    function validFormat(entry){return typeof entry?.exerciseId==="string"&&entry.exerciseId.trim()!==""&&MEASUREMENTS.has(entry.measurement)&&LOAD_TYPES.has(entry.loadType)&&UNITS.has(entry.unit);}
    function entries(){
      const formats=new Map();
      for(const saved of state.history||[]){
        if(saved?.status!=="completed")continue;
        for(const summary of saved.exerciseSummaries||[]){
          if(!validFormat(summary)||!Number.isFinite(Number(summary.completedSets))||Number(summary.completedSets)<=0)continue;
          const key=W.formatKey(summary);if(!formats.has(key))formats.set(key,summary);
        }
      }
      return[...formats].map(([key,entry])=>{
        const metrics=W.metrics(entry).map((metric)=>({...metric,points:W.series(state.history,key,metric.key).filter(validPoint)})).filter((metric)=>metric.points.length);
        const lastStartedAt=Math.max(0,...metrics.flatMap((metric)=>metric.points.map((point)=>Number(point.startedAt)||0)));
        return{key,entry,metrics,lastStartedAt,pointCount:Math.max(0,...metrics.map((metric)=>metric.points.length))};
      }).filter((item)=>item.metrics.length).sort((a,b)=>exercise(a.entry.exerciseId).name.localeCompare(exercise(b.entry.exerciseId).name)||b.lastStartedAt-a.lastStartedAt||a.key.localeCompare(b.key));
    }
    function erase({controls=false}={}){
      chart=Particles.destroy(chart,host());
      $("performanceChart").hidden=true;$("performanceChartFrame").hidden=true;$("chartBaseline").hidden=true;$("chartData").hidden=true;$("chartData").open=false;
      for(const id of ["chartBestValue","chartBestUnit","chartBestLabel","chartStatus","chartTableCaption","chartTableMetric","chartScope"])$(id).textContent="";
      $("chartTableBody").innerHTML="";
      if(controls){for(const id of ["chartExercise","chartMetric"]){$(id).innerHTML="";$(id).value="";}$("chartControls").hidden=true;$("chartEmpty").hidden=true;}
    }
    function clear(){erase({controls:true});}
    function selectedEntry(items){const current=$("chartExercise").value;return items.find((item)=>item.key===current)||items.find((item)=>item.pointCount>=2)||items[0]||null;}
    function selectedMetric(item){const current=$("chartMetric").value;return item?.metrics.find((metric)=>metric.key===current)||item?.metrics.find((metric)=>metric.points.length>=2)||item?.metrics[0]||null;}
    function renderControls(){
      const items=entries(),item=selectedEntry(items);
      if(!item){clear();$("chartEmpty").hidden=false;$("chartEmpty").textContent="Complete a session to see your actual performance here.";$("chartScope").textContent="Only completed sets in the loaded history are included. Logging formats and units stay separate.";return null;}
      $("chartEmpty").hidden=true;$("chartControls").hidden=false;
      $("chartExercise").innerHTML=items.map((candidate)=>`<option value="${esc(candidate.key)}">${esc(exercise(candidate.entry.exerciseId).name)} · ${esc(formatLabel(candidate.entry))}</option>`).join("");
      $("chartExercise").value=item.key;return renderMetricOptions();
    }
    function renderMetricOptions(){
      const item=selectedEntry(entries());
      if(!item){clear();return null;}
      const metric=selectedMetric(item);$("chartMetric").innerHTML=item.metrics.map((candidate)=>`<option value="${esc(candidate.key)}">${esc(candidate.label)} (${esc(candidate.unit)})</option>`).join("");
      $("chartMetric").value=metric.key;return render();
    }
    function scopeText(item,points){
      const entry=item.entry,window=state.hasMore?"; load more to extend the window":"";
      const boundary=entry.loadType==="assisted"?"Assistance is never counted as external load; rep comparisons keep the assistance format separate.":entry.loadType==="bodyweight"?"Bodyweight is excluded from external load and volume records.":entry.measurement==="timed"?"Timed sets stay in seconds and never generate weight-volume records.":"Volume uses only completed sets with recorded external loads.";
      return`Based on ${points.length} exact matching completed session${points.length===1?"":"s"} in ${state.history.length} loaded session${state.history.length===1?"":"s"}${window}. Formats and units are compared separately. ${boundary}`;
    }
    function render(){
      const item=entries().find((candidate)=>candidate.key===$("chartExercise").value),metric=item?.metrics.find((candidate)=>candidate.key===$("chartMetric").value);
      if(!item||!metric){erase();return null;}
      const points=metric.points,best=W.bestInWindow(points),name=exercise(item.entry.exerciseId).name;
      $("performanceChart").hidden=false;$("chartBestValue").textContent=number(best);$("chartBestUnit").textContent=metric.unit;$("chartBestLabel").textContent="Best in loaded history";
      $("chartTableCaption").textContent=`${metric.label} for exact matching completed sessions`;$("chartTableMetric").textContent=metric.label;
      $("chartTableBody").innerHTML=points.map((point)=>`<tr><th scope="row">${esc(point.date)}</th><td>${number(point.value)} ${esc(metric.unit)}</td></tr>`).join("");
      $("chartData").hidden=false;$("chartScope").textContent=scopeText(item,points);
      if(points.length<2){chart=Particles.destroy(chart,host());$("performanceChartFrame").hidden=true;$("chartBaseline").hidden=false;$("chartBaseline").textContent="Baseline recorded. Complete this exact movement, format, and unit again to reveal a comparison.";$("chartStatus").textContent=`One matching ${name} session is available. Another completed session makes the trend visible.`;return{item,metric,points,chart:null};}
      $("chartBaseline").hidden=true;$("performanceChartFrame").hidden=false;
      const data={labels:points.map((point)=>point.date),series:[{name:metric.label,data:points.map((point)=>point.value),color:Particles.ACCENT}]};
      const options=Particles.options({unit:metric.unit,type:"area",reducedMotion:reducedMotion(),format:(value)=>`${number(value)} ${metric.unit}`});
      const chartHost=host();void chartHost.offsetWidth;chart=Particles.upsert(chart,chartHost,data,options,library);
      if(!chart){$("performanceChartFrame").hidden=true;$("chartStatus").textContent="Animated comparison unavailable. Your exact session values remain below.";return{item,metric,points,chart:null};}
      const canvas=host().querySelector?.("canvas");if(canvas){canvas.setAttribute("aria-label",`${name}: ${metric.label} across ${points.length} exact matching completed sessions.`);canvas.setAttribute("aria-describedby","chartStatus chartScope");}
      $("chartStatus").textContent=`Comparing ${points.length} exact matching ${name} sessions in chronological order.`;return{item,metric,points,chart};
    }
    function resize(){return Particles.resize(chart);}
    return{clear,entries,render,renderControls,renderMetricOptions,resize};
  }

  return{create};
});
