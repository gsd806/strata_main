/* global module */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataParticleChart=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const ACCENT="#9fce32";
  const PALETTES=Object.freeze({
    dark:Object.freeze({axis:"rgba(183,188,174,.32)",grid:"rgba(183,188,174,.12)",text:"#b7bcae",crosshair:"rgba(212,245,120,.38)"}),
    light:Object.freeze({axis:"rgba(16,17,15,.32)",grid:"rgba(16,17,15,.1)",text:"#60635d",crosshair:"rgba(200,56,26,.38)"})
  });

  function formatValue(value,unit=""){
    const number=Math.round((Number(value)||0)*100)/100,text=new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(number);
    return unit?`${text} ${unit}`:text;
  }

  function options({unit="",reducedMotion=false,type="line",theme="dark",horizontal=false,color=ACCENT,format,showAxis=true,showGrid=true,showTooltip=true,showValues=false,showLegend=false,beginAtZero=true}={}){
    const palette=PALETTES[theme]||PALETTES.dark,showPoints=true,valueFormat=typeof format==="function"?format:(value)=>formatValue(value,unit);
    return{
      type,theme:PALETTES[theme]?theme:"dark",background:"transparent",responsive:true,maxDpr:1.5,pauseWhenHidden:true,
      animate:!reducedMotion,duration:reducedMotion?0:720,stagger:reducedMotion?0:.2,showAxis,showGrid,showLegend,showTooltip,showValues,showPoints,
      particle:{color,size:.85,sizeJitter:0,density:4,max:8000,bloom:.24,opacity:.78,jitter:0,speed:reducedMotion?0:.085},
      axis:{color:palette.axis,gridColor:palette.grid,textColor:palette.text,crosshairColor:palette.crosshair,fontFamily:'"DM Mono",monospace',fontSize:11,ticks:4,beginAtZero,format:valueFormat,xTitle:horizontal?unit:"",yTitle:horizontal?"":unit},
      line:{curve:"smooth",width:3,points:showPoints},
      bar:{padding:.28,groupPadding:.14,stacked:false,horizontal:Boolean(horizontal),fade:.3,radius:4}
    };
  }

  function clearHost(host){if(!host)return;if(typeof host.replaceChildren==="function")host.replaceChildren();else host.innerHTML="";}
  function destroy(chart,host){if(chart){try{chart.destroy();}catch{}}clearHost(host);return null;}
  function upsert(current,host,data,chartOptions,library=globalThis.ParticleCharts){
    if(!host||!data||typeof library?.ParticleChart!=="function")return destroy(current,host);
    if(current){try{current.update(data,chartOptions);return current;}catch{current=destroy(current,host);}}
    try{return new library.ParticleChart(host,{...chartOptions,data});}catch{return destroy(current,host);}
  }
  function resize(chart){try{chart?.resize();return Boolean(chart);}catch{return false;}}

  return{ACCENT,PALETTES,destroy,formatValue,options,resize,upsert};
});
