/* global module */
(function(root,factory){
  "use strict";
  const calendar=factory();
  if(typeof module==="object"&&module.exports)module.exports=calendar;
  else root.StrataWorkoutCalendar=calendar;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const DAY_MS=24*60*60*1000;
  function dateStamp(date){return `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`;}
  function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
  function escapeIcs(value){return String(value||"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
  function nextPlannedSession(plan,days,from=new Date()){
    const start=new Date(from.getFullYear(),from.getMonth(),from.getDate(),12);
    for(let offset=1;offset<=7;offset++){
      const date=new Date(start.getTime()+offset*DAY_MS),day=days[(date.getDay()+6)%7];
      const items=Array.isArray(plan?.days?.[day])?plan.days[day]:[];
      if(items.length)return{day,date:isoDate(date),movements:items.length,workingSets:items.reduce((total,item)=>total+(Number.isFinite(Number(item?.sets))?Math.max(0,Number(item.sets)):0),0)};
    }
    return null;
  }
  function event(session){
    if(!session)return null;
    const start=new Date(`${session.date}T12:00:00`),end=new Date(start.getTime()+DAY_MS),title=`STRATA · ${session.day} workout`;
    const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//STRATA//Training Plan//EN","CALSCALE:GREGORIAN","BEGIN:VEVENT",`DTSTART;VALUE=DATE:${dateStamp(start)}`,`DTEND;VALUE=DATE:${dateStamp(end)}`,`SUMMARY:${escapeIcs(title)}`,`DESCRIPTION:${escapeIcs(`${session.movements} planned movement${session.movements===1?"":"s"} · ${session.workingSets} working set${session.workingSets===1?"":"s"}. Open STRATA when you are ready to train.`)}`,"END:VEVENT","END:VCALENDAR",""];
    return{...session,title,filename:`strata-${session.date}-${session.day.toLowerCase()}.ics`,href:`data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`};
  }
  return{nextPlannedSession,event};
});
