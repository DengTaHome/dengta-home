export const ACTIONS={
 idle:{label:'安静陪伴',duration:0,priority:0,cooldown:0},
 left:{label:'看左边',duration:3,priority:3,cooldown:2},right:{label:'看右边',duration:3,priority:3,cooldown:2},
 greet:{label:'回应名字',duration:3.5,priority:3,cooldown:2},
 pet:{label:'摸摸头',duration:3,priority:2,cooldown:2},
 paw:{label:'抬左爪',duration:4,priority:3,cooldown:2},pawRight:{label:'抬右爪',duration:4,priority:3,cooldown:2},
 lick:{label:'舔鼻子',duration:2,priority:3,cooldown:5},
 feed:{label:'手喂零食',duration:6,priority:3,cooldown:8,commit:3.6},
 drink:{label:'递水喝',duration:6,priority:3,cooldown:8,commit:3.6},
 rest:{label:'坐着打盹',duration:0,priority:1,cooldown:2},wake:{label:'醒来看看',duration:2.5,priority:4,cooldown:2},
 ball:{label:'拨球玩',duration:6,priority:3,cooldown:4},brush:{label:'梳梳毛',duration:4,priority:2,cooldown:3},
};
export const ease=t=>{t=Math.min(1,Math.max(0,t));return t*t*t*(10+t*(-15+6*t));};
export class InteractionController{
 constructor(){this.time=0;this.active={id:'idle',at:0,committed:false};this.last=new Map();this.history=[];this.stats={mood:76,intimacy:65,satiety:60,water:70,energy:75,cleanliness:80};this.intentSerial=0;}
 request(id,{force=false}={}){
  const action=ACTIONS[id];if(!action)return{accepted:false,reason:'这个动作尚未制作'};
  if(id==='idle')force=true;
  if(!force&&this.time-(this.last.get(id)??-Infinity)<Math.max(2,action.cooldown))return{accepted:false,reason:'等小棉花缓一缓，再试一次'};
  if(!force&&this.active.id!=='idle'&&action.priority<ACTIONS[this.active.id].priority)return{accepted:false,reason:'等当前动作完成后再来'};
  if(this.active.id!=='idle')this.history.push({type:'interrupt',id:this.active.id,time:this.time});
  this.active={id,at:this.time,committed:false,serial:++this.intentSerial};this.last.set(id,this.time);this.history.push({type:'start',id,time:this.time});return{accepted:true};
 }
 update(dt){if(!Number.isFinite(dt)||dt<0)return;this.time+=Math.min(.1,dt);const {id,at}=this.active,def=ACTIONS[id],age=this.time-at;
  if(def.commit&&!this.active.committed&&age>=def.commit){this.active.committed=true;this.change(id==='feed'?'satiety':'water',18);this.change('mood',3);this.history.push({type:'consume',id,serial:this.active.serial,time:this.time});}
  if(id==='rest')this.change('energy',dt*.12);
  if(def.duration&&age>=def.duration){if(['pet','paw','pawRight','ball','brush'].includes(id)){this.change('mood',2);this.change('intimacy',1);}if(id==='brush')this.change('cleanliness',8);this.history.push({type:'finish',id,time:this.time});this.active={id:'idle',at:this.time,committed:false};}
 }
 change(key,delta){this.stats[key]=Math.min(100,Math.max(0,this.stats[key]+delta));}
 get age(){return this.time-this.active.at;}
 get envelope(){const def=ACTIONS[this.active.id],age=this.age;return ease(age/.55)*(def.duration?1-ease((age-def.duration+.65)/.65):1);}
 diagnostics(){return{active:{...this.active},age:this.age,envelope:this.envelope,stats:{...this.stats}};}
}

// Small toy in authoring metres: stable substeps, gravity and finite rebounds.
export class BallPhysics{
 constructor({gravity=2.8,bounds={x:[-.34,.34],z:[.23,.48]}}={}){this.radius=.027;this.gravity=gravity;this.bounds=bounds;this.reset();}
 reset(){this.position={x:.25,y:.027,z:.27};this.velocity={x:0,y:0,z:0};this.held=false;}
 impulse(x= -.55,y=.55,z=0){this.velocity={x,y,z};}
 update(dt){if(this.held||!Number.isFinite(dt)||dt<0)return;let left=Math.min(dt,.1);while(left>0){const d=Math.min(left,1/120);left-=d;this.velocity.y-=this.gravity*d;for(const k of ['x','y','z'])this.position[k]+=this.velocity[k]*d;
   if(this.position.y<this.radius){this.position.y=this.radius;this.velocity.y=Math.abs(this.velocity.y)>.09?-this.velocity.y*.55:0;this.velocity.x*=Math.exp(-2.3*d);this.velocity.z*=Math.exp(-2.3*d);}
   for(const k of ['x','z']){if(!this.bounds?.[k])continue;const [low,high]=this.bounds[k];if(this.position[k]<low||this.position[k]>high){this.position[k]=Math.min(high,Math.max(low,this.position[k]));this.velocity[k]*=-.62;}}
  }}
}
