/* global module, require */
(function(root,factory){
  const api=factory(typeof module==="object"&&module.exports?require("./home-logic"):root.StrataHomeLogic);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataHomeState=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(logic){
  "use strict";

  function createState(){
    return{
      group:"chest",sub:"all",query:"",equipment:"all",level:"all",sort:"score",compare:[],
      exercises:[],user:null,accountStatus:"loading",catalogStatus:"loading"
    };
  }

  function setCatalog(state,catalog){state.exercises=logic.normalizeCatalog(catalog);state.catalogStatus="ready";return state.exercises;}
  function failCatalog(state){state.exercises=[];state.compare=[];state.catalogStatus="error";}
  function selectGroup(state,group){if(!logic.GROUPS[group])return false;state.group=group;state.sub="all";return true;}
  function selectSubfilter(state,sub){if(sub!=="all"&&!logic.GROUPS[state.group]?.subs.includes(sub))return false;state.sub=sub;return true;}
  function resetFilters(state){state.sub="all";state.equipment="all";state.level="all";state.query="";}
  function beginAccountRecheck(state){state.user=null;state.accountStatus="rechecking";}
  function setAccount(state,user){state.user=user||null;state.accountStatus=state.user?"authenticated":"anonymous";}

  return{beginAccountRecheck,createState,failCatalog,resetFilters,selectGroup,selectSubfilter,setAccount,setCatalog};
});
