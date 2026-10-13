import * as THREE from 'three';import {BallPhysics,ease} from './interaction-controller.js';
export class InteractionProps{
 constructor(scene,pet){this.pet=pet;this.ballPhysics=new BallPhysics();this.lastSerial=-1;this.ballHit=false;this.presence={hand:0,cup:0,brush:0};this.group=new THREE.Group();scene.add(this.group);
  const mat=c=>new THREE.MeshStandardMaterial({color:c,roughness:.7});const sphere=(parent,scale,position,material)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1,18,12),material);m.scale.set(...scale);m.position.set(...position);m.castShadow=true;parent.add(m);return m;};
  this.ball=new THREE.Mesh(new THREE.SphereGeometry(.027,28,18),mat(0xd9a775));this.ball.castShadow=true;this.ball.name='Interactive_ball';this.group.add(this.ball);
  const stripe=new THREE.Mesh(new THREE.TorusGeometry(.0272,.0015,6,48),mat(0xffedc6));this.ball.add(stripe);
  this.hand=new THREE.Group();this.group.add(this.hand);const glove=mat(0xe1b49b);sphere(this.hand,[.027,.012,.026],[.02,-.02,.015],glove);for(let i=0;i<4;i++)sphere(this.hand,[.004,.007,.015],[.002+i*.009,-.015,-.012],glove);sphere(this.hand,[.007,.008,.019],[.045,-.014,.005],glove);
  this.treat=sphere(this.hand,[.008,.005,.008],[0,0,0],mat(0x996343));
  this.cup=new THREE.Group();this.group.add(this.cup);const bowl=new THREE.Mesh(new THREE.SphereGeometry(.033,28,16,0,Math.PI*2,Math.PI/2,Math.PI/2),new THREE.MeshStandardMaterial({color:0xabc8c4,side:THREE.DoubleSide,roughness:.48}));bowl.scale.y=.65;this.cup.add(bowl);const rim=new THREE.Mesh(new THREE.TorusGeometry(.033,.002,8,40),mat(0x8bafaa));rim.rotation.x=Math.PI/2;this.cup.add(rim);this.water=new THREE.Mesh(new THREE.CircleGeometry(.03,32),new THREE.MeshStandardMaterial({color:0x9dd5de,transparent:true,opacity:.65,side:THREE.DoubleSide,roughness:.25}));this.water.rotation.x=-Math.PI/2;this.water.position.y=-.003;this.cup.add(this.water);
  this.brush=new THREE.Group();this.group.add(this.brush);sphere(this.brush,[.024,.008,.035],[0,0,0],mat(0xb89164));for(let i=0;i<6;i++)sphere(this.brush,[.0018,.008,.025],[-.015+i*.006,-.009,0],mat(0xf0dfc5));
  this.collar=new THREE.Mesh(new THREE.TorusGeometry(.115,.008,8,64),mat(0xb7877b));this.collar.rotation.x=Math.PI/2;this.collar.position.copy(new THREE.Vector3(0,.31,.075).sub(pet.rest.neck));pet.named.neck.add(this.collar);this.collar.visible=false;
  this.frame=new THREE.Group();this.frame.position.set(-.31,.12,-.01);this.frame.rotation.y=.15;this.group.add(this.frame);const board=new THREE.Mesh(new THREE.BoxGeometry(.14,.16,.012),mat(0xb49373));this.frame.add(board);this.photo=new THREE.Mesh(new THREE.PlaneGeometry(.122,.142),mat(0xe6dfc8));this.photo.position.z=.0065;this.frame.add(this.photo);this.frame.visible=false;
 }
 setPhoto(texture){this.photo.material.map?.dispose();this.photo.material.map=texture;this.photo.material.needsUpdate=true;this.frame.visible=true;}
 update(dt,controller){const {id,serial}=controller.active,age=controller.age,e=controller.envelope;if(serial!==this.lastSerial){this.lastSerial=serial;this.ballHit=false;this.ballStart={...this.ballPhysics.position};}
  const reachTarget=ease(age/1.5)*(1-ease((age-4.7)/1.3));for(const [key,active] of [['hand','feed'],['cup','drink'],['brush','brush']]){const target=id===active?(key==='brush'?e:reachTarget):0;this.presence[key]+=(target-this.presence[key])*(1-Math.exp(-12*dt));this[key].visible=this.presence[key]>.003;this[key].traverse(o=>{if(o.isMesh){o.material.transparent=true;o.material.opacity=this.presence[key];}});}
  const mouth=this.pet.named.head.localToWorld(new THREE.Vector3(0,-.012,.123));
  if(this.hand.visible){const reach=this.presence.hand;this.hand.position.copy(mouth).add(new THREE.Vector3(.30*(1-reach),-.015-.12*(1-reach),.018));if(id==='feed')this.treat.visible=!controller.active.committed;}
  if(this.cup.visible){const reach=this.presence.cup;this.cup.position.copy(mouth).add(new THREE.Vector3(.24*(1-reach),-.012-.20*(1-reach),.027));if(id==='drink')this.water.position.y=-.003-(controller.active.committed?.005:0);this.water.rotation.z=Math.sin(age*13)*.015;}
  if(this.brush.visible){this.brush.position.copy(this.pet.named.head.localToWorld(new THREE.Vector3(.07+Math.sin(age*4)*.026,.105,.015)));this.brush.rotation.z=.2*Math.sin(age*4);}
  if(id==='ball'&&age<1.4&&!this.ballPhysics.held){const t=ease(age/1.4);this.ballPhysics.position={x:this.ballStart.x+(.075-this.ballStart.x)*t,y:this.ballPhysics.radius,z:this.ballStart.z+(.24-this.ballStart.z)*t};this.ballPhysics.velocity={x:0,y:0,z:0};}
  else{if(id==='ball'&&age>=1.4&&!this.ballHit&&!this.ballPhysics.held){this.ballPhysics.impulse(.38,.38,.46);this.ballHit=true;}this.ballPhysics.update(dt);}
  this.ball.position.set(this.ballPhysics.position.x,this.ballPhysics.position.y,this.ballPhysics.position.z);this.ball.rotation.x+=this.ballPhysics.velocity.z*dt/.027;this.ball.rotation.z-=this.ballPhysics.velocity.x*dt/.027;
 }
}
