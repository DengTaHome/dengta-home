import * as THREE from 'three';
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
export class B1857Character{
 constructor({asset}={}){
  const data=asset;
  this.group=new THREE.Group();this.group.name='B1857_Seated_Study';this.named={};this.bones=[];this.rest={};this.time=0;this.mode='idle';this.started=0;this.look={yaw:0,pitch:0,roll:0};this.velocity={yaw:0,pitch:0,roll:0};this.nextLook=3.1;this.idleTarget={yaw:.06,pitch:0,roll:0};this.rng=7381;
  for(const item of data.bones){const b=new THREE.Bone();b.name=item.name;this.rest[item.name]=new THREE.Vector3(...item.head);this.named[item.name]=b;this.bones.push(b);if(item.parent){this.named[item.parent].add(b);b.position.copy(this.rest[item.name]).sub(this.rest[item.parent]);}else{this.group.add(b);b.position.copy(this.rest[item.name]);}}
  this.group.updateMatrixWorld(true);this.skeleton=new THREE.Skeleton(this.bones);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.skinIndices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(data.skinWeights,4));g.setIndex(data.indices);
  const colors=[],zones=[];
  for(let i=0;i<data.positions.length;i+=3){const [x,y,z]=data.positions.slice(i,i+3);let c=new THREE.Color(0xf5eee1),zone=0;
   const eye=((Math.abs(x)-.039)/.0108)**2+((y-.383)/.011)**2;
   if(z>.195&&eye<1){c.setHex(eye<.25?0x110e0b:eye<.80?0x382719:0x262018);zone=1;}
   const nose=(x/.013)**2+((y-.3605)/.0068)**2;if(z>.252&&nose<1.1){c.setHex(0x795750);zone=2;}
   const ear=((Math.abs(x)-.083)/.017)**2+((y-.466)/.02)**2;if(z>.11&&ear<.7){c.lerp(new THREE.Color(0xd4b7a6),(1-ear)*.36);}
   colors.push(c.r,c.g,c.b);zones.push(zone);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.clearGroups();const buckets=[[],[],[]];
  for(let i=0;i<data.indices.length;i+=3){const z=zones[data.indices[i]]===zones[data.indices[i+1]]&&zones[data.indices[i]]===zones[data.indices[i+2]]?zones[data.indices[i]]:0;buckets[z].push(data.indices[i],data.indices[i+1],data.indices[i+2]);}
  let start=0;for(let i=0;i<3;i++){g.addGroup(start,buckets[i].length,i);start+=buckets[i].length;}g.setIndex(buckets.flat());
  this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8});this.materials=[this.material,new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.15,clearcoat:1,clearcoatRoughness:.1}),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.47})];
  this.mesh=new THREE.SkinnedMesh(g,this.materials);this.mesh.name='Purchased_Pomeranian_Sculpt';this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.group.add(this.mesh);this.mesh.bind(this.skeleton);this.mesh.normalizeSkinWeights();
  const blink=data.positions.slice();for(let i=0;i<blink.length;i+=3){const x=blink[i],y=blink[i+1],z=blink[i+2],r=((Math.abs(x)-.039)/.019)**2+((y-.383)/.022)**2;if(z>.185&&r<1)blink[i+1]=y-(y-.383)*.96*Math.cos(Math.sqrt(r)*Math.PI/2)**2;}
  g.morphAttributes.position=[new THREE.Float32BufferAttribute(blink,3)];g.morphAttributes.position[0].name='Blink';this.mesh.updateMorphTargets();
  this.tongue=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshStandardMaterial({color:0xcc7e85,roughness:.65}));this.tongue.name='Pet_tongue';this.named.head.add(this.tongue);this.tongue.visible=false;
  this.channels={liftL:0,liftR:0,close:0,lick:0,excite:.25};this.interaction=null;this.nextBlink=2.4;this.blinkAt=-Infinity;this.blinkDuration=.22;this.blink=0;
  this.helper=new THREE.SkeletonHelper(this.group);this.helper.material.depthTest=false;this.helper.renderOrder=5;this.helper.visible=false;this.accumulator=0;this.updatePose();
 }
 random(){this.rng=(Math.imul(this.rng,1664525)+1013904223)>>>0;return this.rng/4294967296;}
 command(mode){this.mode=mode;this.started=this.time;}
 setInteraction(frame){this.interaction=frame;}
 update(dt){if(!Number.isFinite(dt)||dt<0)return;this.accumulator+=Math.min(.1,dt);while(this.accumulator>=1/120){this.tick(1/120);this.accumulator-=1/120;}this.updatePose();}
 tick(dt){
  this.time+=dt;const elapsed=this.time-this.started;
  if(this.time>=this.nextBlink){this.blinkAt=this.time;this.blinkDuration=.18+this.random()*.08;this.nextBlink=this.time+3+this.random()*5;}
  const blinkAge=this.time-this.blinkAt;this.blink=blinkAge<this.blinkDuration?Math.sin(blinkAge/this.blinkDuration*Math.PI)**2:0;
  if(!this.interaction&&this.mode!=='idle'&&elapsed>5.5){this.mode='idle';this.started=this.time;}
  if(this.time>this.nextLook){this.nextLook=this.time+3+this.random()*4;this.idleTarget={yaw:(this.random()-.5)*.17,pitch:(this.random()-.5)*.05,roll:(this.random()-.5)*.045};}
  const target={...this.idleTarget};
  if(this.mode==='left'){target.yaw=-.29;target.roll=-.035;}
  if(this.mode==='right'){target.yaw=.29;target.roll=.035;}
  if(this.mode==='greet'){target.yaw=.035*Math.sin(elapsed*2);target.pitch=-.055;target.roll=.075*smooth(elapsed/.7);}
  if(this.mode==='paw'){target.yaw=.055;target.pitch=.035;target.roll=-.04;}
  const f=this.interaction,age=f?.age??elapsed,env=f?.envelope??1;
  if(f){this.mode=f.id;if(f.look)Object.assign(target,f.look);}
  if(['pet','brush'].includes(this.mode)){target.pitch=.045*env;target.roll=Math.sin(age*2)*.035*env;}
  if(['feed','drink'].includes(this.mode)){target.yaw=0;target.pitch=.035*env;target.roll=0;}
  if(this.mode==='rest'){target.pitch=.13*env;target.roll=.035*env;target.yaw=0;}
  if(this.mode==='wake'){target.pitch=-.05*env;target.roll=0;}
  if(this.mode==='pawRight'){target.yaw=-.055;target.pitch=.035;target.roll=.04;}
  const lift=smooth(age/.8)*(1-smooth((age-2.5)/.9));
  const desired={liftL:['paw','ball'].includes(this.mode)?lift:0,liftR:this.mode==='pawRight'?lift:0,close:this.mode==='rest'?env:this.mode==='pet'?.8*env:0,lick:this.mode==='lick'?Math.max(0,Math.sin(age*9))*env:['feed','drink'].includes(this.mode)&&age>2.1&&age<4.5?Math.max(0,Math.sin(age*14))*env:0,excite:['greet','ball'].includes(this.mode)?1:.25};
  for(const k of Object.keys(this.channels))this.channels[k]+=(desired[k]-this.channels[k])*(1-Math.exp(-(k==='lick'?30:9)*dt));
  for(const key of ['yaw','pitch','roll']){const omega=key==='yaw'?7:5.5;this.velocity[key]+=(omega*omega*(target[key]-this.look[key])-2*omega*this.velocity[key])*dt;this.look[key]+=this.velocity[key]*dt;}
 }
 updatePose(){
  const t=this.time;for(const b of this.bones){b.quaternion.identity();b.scale.set(1,1,1);if(b.parent.isBone)b.position.copy(this.rest[b.name]).sub(this.rest[b.parent.name]);else b.position.copy(this.rest[b.name]);}
  const breath=Math.sin(t*2*Math.PI/3.4)*.003;
  this.named.chest.scale.set(1+breath,1+breath*.45,1+breath*.6);
  this.named.neck.rotation.set(this.look.pitch*.22,this.look.yaw*.24,this.look.roll*.2);
  this.named.head.rotation.set(this.look.pitch*.78,this.look.yaw*.76,this.look.roll*.8);
  // Short, separate ear reactions rather than permanent symmetric oscillation.
  const ear=Math.max(0,1-Math.abs((t%7.7)-.4)/.22);
  this.named['ear.L'].rotation.z=ear*.055;this.named['ear.R'].rotation.z=-ear*.022;
  const excited=this.channels?.excite??.25;
  for(let i=0;i<4;i++)this.named['tail_'+i].rotation.z=Math.sin(t*(excited>.5?5:2.5)-i*.35)*(.018+i*.009)*excited;
  const lift=this.channels?.liftL??0,liftR=this.channels?.liftR??0;
  // Only a small seated paw lift is supported by this fused sculpt. The larger
  // handshake/standing poses require separating the paw and retopologizing.
  this.named['fore.L.lower'].rotation.x=-lift*.07;
  this.named['fore.R.lower'].rotation.x=-liftR*.07;
  this.group.updateMatrixWorld(true);
  for(const side of ['L','R']){
    const paw=this.named['fore.'+side+'.paw'],position=this.rest[paw.name].clone();position.y+=(side==='L'?lift:liftR)*.012;
    paw.position.copy(paw.parent.worldToLocal(this.group.localToWorld(position)));paw.quaternion.copy(paw.parent.getWorldQuaternion(new THREE.Quaternion()).invert());paw.updateMatrixWorld(true);
  }
  this.mesh.morphTargetInfluences[0]=Math.max(this.blink??0,this.channels?.close??0);
  const lick=this.channels?.lick??0;this.tongue.visible=lick>.03;this.tongue.scale.set(.0055,.0016,.004+.012*lick);this.tongue.position.set(0,-.015+.016*lick,.111+.007*lick);this.tongue.rotation.x=-.6*lick;
  this.group.updateMatrixWorld(true);this.skeleton.update();this.helper.updateMatrixWorld(true);
 }
 diagnostics(){return{time:this.time,mode:this.mode,look:{...this.look},bones:this.bones.length,triangles:this.mesh.geometry.index.count/3};}
}
