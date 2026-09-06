(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataOnboarding=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  function buildWeek(profile,exercises,discovery,makeId){
    const days=DAYS.filter(day=>profile?.availability?.includes(day));
    if(days.length<1||days.length>6)throw new Error("Choose one to six training days, leaving at least one recovery day.");
    const equipment=[...new Set(profile.equipment||[])].filter(value=>exercises.some(exercise=>exercise.equipment===value));
    if(!equipment.length)throw new Error("Choose the equipment you can actually use.");
    if(!["hypertrophy","strength","balanced","time-efficient"].includes(profile.goal)||!["Beginner","Intermediate","Advanced"].includes(profile.level))throw new Error("Choose a goal and experience level.");
    const minutes=Number(profile.minutes);
    if(![20,35,50].includes(minutes))throw new Error("Choose 20, 35, or 50 minutes per session.");
    const preferences={version:1,goal:profile.goal,level:profile.level,days:days.length,equipment,preferences:["stable","simple-setup"],limitations:profile.limitations||[]};
    const plan={version:1,restDay:[...DAYS].reverse().find(day=>!days.includes(day)),days:Object.fromEntries(DAYS.map(day=>[day,[]]))};
    const sessions=[];
    for(const [index,day] of days.entries()){
      const focus=days.length>=4?(index%2===0?"upper":"lower"):"full";
      const session=discovery.buildSession({exercises,preferences,focus,minutes,weeklyPlan:plan});
      plan.days[day]=session.items.map((item,i)=>({instanceId:makeId?makeId():`setup-${day}-${i}-${item.exerciseId}`,exerciseId:item.exerciseId,sets:item.sets,reps:item.reps}));
      sessions.push({day,...session});
    }
    return {plan,sessions,preferences};
  }
  return {DAYS,buildWeek};
});
