import type {JsonObject} from "./domain-types";

export function sanitizeWorkout(value:unknown,now?:number):JsonObject;
export function summarizeWorkout(workout:Record<string,any>):{
  id:string;
  title:string;
  planDay:string;
  date:string;
  status:string;
  startedAt:number;
  completedAt:number|null;
  elapsedSeconds:number;
  totalSets:number;
  completedSets:number;
  exerciseCount:number;
  exerciseSummaries:Array<{
    exerciseId:string;
    measurement:"reps"|"timed";
    loadType:"external"|"bodyweight"|"assisted";
    unit:"kg"|"lb";
    completedSets:number;
    totalReps:number;
    maxReps:number|null;
    maxWeight:number|null;
    minAssistance:number|null;
    volume:number;
    totalSeconds:number;
    maxSeconds:number|null;
  }>;
};
