/* global module, require */
(function(root,factory){
  const progress=typeof module==="object"&&module.exports?require("./discover-progress"):root.StrataDiscoverProgress;
  const particle=typeof module==="object"&&module.exports?require("./particle-chart-core"):root.StrataParticleChart;
  const api=factory(progress,particle);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscoverChart=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(Progress,Particle){
  "use strict";

  const theme=Particle.options({type:"area"});
  const THEME=Object.freeze({...theme,particle:Object.freeze(theme.particle),axis:Object.freeze(theme.axis),line:Object.freeze(theme.line),bar:Object.freeze(theme.bar)});
  function formatValue(value,unit=""){
    const number=Math.round((Number(value)||0)*100)/100,text=new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(number);
    if(unit==="seconds")return Progress.formatDuration(number);
    return unit?`${text} ${unit}`:text;
  }
  function chartOptions(metric,reducedMotion=false){return Particle.options({type:"area",unit:metric.unit,reducedMotion,format:(value)=>formatValue(value,metric.unit)});}
  function createProgressChart({element,state,exerciseName,readableDate,escapeHtml,library=globalThis.ParticleCharts,reducedMotion=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true}){
    let chart=null;
    const node=(id)=>element(id);
    function destroy(){chart=Particle.destroy(chart,node("trainingMemoryChart"));}
    function clear({wipe=false}={}){
      destroy();
      if(!wipe)return;
      state.progressChartKey="";state.progressChartMetric="";
      for(const id of ["trainingMemoryMovement","trainingMemoryMetric"]){const control=node(id);if(control){control.innerHTML="";control.value="";}}
      const values=node("trainingMemoryExactValues");if(values)values.innerHTML="";
      const status=node("trainingMemoryTrendStatus");if(status)status.textContent="";
      const scope=node("trainingMemoryTrendScope");if(scope)scope.textContent="";
      const root=node("trainingMemoryTrend");if(root)root.hidden=true;
    }
    function showUnavailable(title,message,{keepValues=false}={}){
      destroy();
      const frame=node("trainingMemoryChartFrame"),empty=node("trainingMemoryTrendEmpty"),controls=node("trainingMemoryTrendControls"),details=node("trainingMemoryExact");
      if(frame)frame.hidden=true;if(empty)empty.hidden=false;if(node("trainingMemoryTrendEmptyTitle"))node("trainingMemoryTrendEmptyTitle").textContent=title;if(node("trainingMemoryTrendEmptyDetail"))node("trainingMemoryTrendEmptyDetail").textContent=message;if(controls)controls.hidden=!keepValues;if(details)details.hidden=!keepValues;
      if(!keepValues){for(const id of ["trainingMemoryMovement","trainingMemoryMetric","trainingMemoryExactValues"]){const item=node(id);if(item){item.innerHTML="";if("value" in item)item.value="";}}for(const id of ["trainingMemoryTrendStatus","trainingMemoryTrendScope"]){const item=node(id);if(item)item.textContent="";}}
    }
    function setOptions(entries,entry,metric){
      const exercise=node("trainingMemoryMovement"),measure=node("trainingMemoryMetric");
      exercise.innerHTML=entries.map((item)=>`<option value="${escapeHtml(item.key)}">${escapeHtml(exerciseName(item.exerciseId))} — ${escapeHtml(item.format)}</option>`).join("");exercise.value=entry.key;
      measure.innerHTML=entry.metrics.map((item)=>`<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`).join("");measure.value=metric.key;
    }
    function setExactValues(points,metric){
      const body=node("trainingMemoryExactValues");if(!body)return;
      body.innerHTML=`<table><caption>${escapeHtml(metric.label)} by completed session</caption><thead><tr><th scope="col">Session</th><th scope="col">Exact value</th></tr></thead><tbody>${points.map((point)=>`<tr><th scope="row">${escapeHtml(readableDate(point.date))}</th><td>${escapeHtml(formatValue(point.value,metric.unit))}</td></tr>`).join("")}</tbody></table>`;
    }
    function render({workouts,historyAvailable,hasMore=false}){
      const root=node("trainingMemoryTrend");if(!root)return null;root.hidden=false;
      if(!historyAvailable){showUnavailable("HISTORY UNAVAILABLE.","Reconnect to load only your verified completed sessions.");return null;}
      const entries=Progress.chartEntries(workouts),entry=Progress.preferredChartEntry(entries,state.progressChartKey);
      if(!entry){showUnavailable("COMPLETE A WORKOUT TO START.","Your first completed movement creates a baseline. Repeat the same format and unit to reveal a trend.");return null;}
      state.progressChartKey=entry.key;
      const metric=Progress.preferredChartMetric(entry,state.progressChartMetric);state.progressChartMetric=metric.key;setOptions(entries,entry,metric);
      const points=metric.points,exercise=exerciseName(entry.exerciseId),status=node("trainingMemoryTrendStatus"),details=node("trainingMemoryExact"),controls=node("trainingMemoryTrendControls"),host=node("trainingMemoryChart"),frame=node("trainingMemoryChartFrame"),empty=node("trainingMemoryTrendEmpty"),scopeNode=node("trainingMemoryTrendScope");
      controls.hidden=false;details.hidden=false;setExactValues(points,metric);
      const scope=hasMore?" within the 100 most recent sessions; older sessions are not included":"";
      scopeNode.textContent=`${points.length} exact ${points.length===1?"point":"points"}${hasMore?" · 100-session history window":" · full loaded history"}`;
      status.textContent=points.length===1?`One exact ${exercise} point${scope}. Repeat this logging format to reveal a trend.`:`${points.length} matching completed ${exercise} sessions${scope}. Formats and units are kept separate.`;
      if(points.length<2){showUnavailable("BASELINE RECORDED.",`Repeat ${exercise} with this exact logging format and unit to draw a truthful trend.`,{keepValues:true});return{entry,metric,points};}
      frame.hidden=false;host.hidden=false;empty.hidden=true;
      const data={labels:points.map((point)=>readableDate(point.date)),series:[{name:metric.label,data:points.map((point)=>point.value),color:"#9fce32"}]},options=chartOptions(metric,reducedMotion());
      try{
        chart=Particle.upsert(chart,host,data,options,library);if(!chart)throw new Error("Particle chart unavailable");
        const canvas=host.querySelector?.("canvas");if(canvas){canvas.setAttribute("aria-label",`${exercise}: ${metric.label} across ${points.length} matching completed ${points.length===1?"session":"sessions"}.`);canvas.setAttribute("aria-describedby","trainingMemoryTrendStatus");}
      }catch{showUnavailable("ANIMATED VIEW UNAVAILABLE.","Your exact completed-session values remain available below.",{keepValues:true});}
      return{entry,metric,points};
    }
    function resize(){Particle.resize(chart);}
    return{clear,destroy,render,resize};
  }

  return{THEME,chartOptions,createProgressChart,formatValue};
});
