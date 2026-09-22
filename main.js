
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
 
// scene
const scene = new THREE.Scene();
new RGBELoader().load("textures/sky.hdr", (hdrTexture) => {
  hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdrTexture;
  scene.environment = hdrTexture;
});
 
// camera
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.7, 5);
 
// renderer
const PIXEL_SCALE = 0.25;
 
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1); // ignore devicePixelRatio so pixels stay chunky on retina screens
renderer.domElement.style.imageRendering = "pixelated"; // Chrome/Firefox
renderer.domElement.style.imageRendering = "-moz-crisp-edges"; // Firefox fallback
document.body.appendChild(renderer.domElement);
 
function resizeRenderer() {
  const w = Math.floor(window.innerWidth * PIXEL_SCALE);
  const h = Math.floor(window.innerHeight * PIXEL_SCALE);
  renderer.setSize(w, h, false); // false = don't touch the canvas's CSS size...
  renderer.domElement.style.width = "100vw";  // ...we set that ourselves so it stretches up
  renderer.domElement.style.height = "100vh";
}
resizeRenderer();
 
// light
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2));
 
// flat ground
const texLoader = new THREE.TextureLoader();
const rockDiffuse = texLoader.load("textures/rockDif.png");
rockDiffuse.colorSpace = THREE.SRGBColorSpace;
rockDiffuse.wrapS = rockDiffuse.wrapT = THREE.RepeatWrapping;
rockDiffuse.repeat.set(20, 20);   // tune this: bigger = smaller tiles
rockDiffuse.magFilter = THREE.NearestFilter; // blocky instead of blurred when magnified
rockDiffuse.minFilter = THREE.NearestMipmapNearestFilter; // blocky at a distance too, still avoids shimmering
// with PIXEL_SCALE already rendering at low resolution, anisotropy
// and mipmapping barely matter visually — leaving anisotropy off (or at
// its default of 1) keeps things consistently chunky rather than having
// the texture sharpen up at grazing angles while the geometry stays blocky.
 
// height function: given a position, returns how tall the ground is there
function getHeight(x, z) {
  return Math.sin(x * 0.05) * 3
    + Math.cos(z * 0.07) * 3
    + Math.sin((x + z) * 0.12) * 1;
}
 
// plane with many vertices, rotated flat
const groundGeo = new THREE.PlaneGeometry(200, 200, 8, 8);
groundGeo.rotateX(-Math.PI / 2);
 
// move each vertex up or down according to getHeight
const pos = groundGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  pos.setY(i, getHeight(pos.getX(i), pos.getZ(i)));
}
groundGeo.computeVertexNormals();
 
// the mesh, now using the bumpy geometry
const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshLambertMaterial({ map: rockDiffuse, flatShading: true })
);
scene.add(ground);
 
const groundRaycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();
 
function groundHeightAt(x, z) {
  rayOrigin.set(x, 100, z);
  groundRaycaster.set(rayOrigin, down);
  const hit = groundRaycaster.intersectObject(ground)[0];
  return hit ? hit.point.y : 0;
}
 
// ---------------------------------------------------------------
// NOTEBOOK — interactive object
// ---------------------------------------------------------------
// `notebook` is whatever Object3D you want to be clickable. Right now
// it's a placeholder box so the interaction logic can be tested without
// a model. Swap it for your Blender export using the GLTFLoader block
// below — just make sure the loaded scene gets assigned to `notebook`
// and positioned/scaled the same way.
 
const NOTEBOOK_POSITION = new THREE.Vector3(5, 0, -2);
const NOTEBOOK_INTERACT_DISTANCE = 3.2; // how close you need to be, in world units
const NOTEBOOK_MESSAGE = "You found an old notebook. The pages are damp, but a few lines are still legible...";
 
let notebook = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.06, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x6b4a2f })
);
notebook.position.copy(NOTEBOOK_POSITION);
notebook.position.y = groundHeightAt(NOTEBOOK_POSITION.x, NOTEBOOK_POSITION.z) + 0.5; // sits on top of a rock/table height, adjust as needed
scene.add(notebook);
 
// --- To use your Blender model instead of the placeholder box: -------
// 1. In Blender: Ctrl+A -> Apply All Transforms, then
//    File > Export > glTF 2.0 (.glb), format = glTF Binary.
// 2. Put the exported file at /models/notebook.glb next to this html file.
// 3. Uncomment the block below and delete/comment the placeholder Mesh above.
//
// const loader = new GLTFLoader();
// loader.load("models/notebook.glb", (gltf) => {
//   scene.remove(notebook);           // remove the placeholder
//   notebook = gltf.scene;
//   notebook.position.copy(NOTEBOOK_POSITION);
//   notebook.position.y = groundHeightAt(NOTEBOOK_POSITION.x, NOTEBOOK_POSITION.z);
//   notebook.scale.setScalar(1);      // adjust to taste — glTF units are meters
//   scene.add(notebook);
// });
 
// helper: is `obj` the notebook itself, or nested inside it?
// (needed because a GLTF import is a Group containing multiple meshes)
function belongsToNotebook(obj) {
  let cur = obj;
  while (cur) {
    if (cur === notebook) return true;
    cur = cur.parent;
  }
  return false;
}
 
// --- message box UI ---------------------------------------------
const messageBox = document.getElementById("message-box");
let messageTimeout = null;
 
function showMessage(text, durationMs = 4000) {
  messageBox.textContent = text;
  messageBox.classList.add("visible");
  if (messageTimeout) clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => {
    messageBox.classList.remove("visible");
  }, durationMs);
}
 
// --- interaction raycast (from the center of the screen, since the
// cursor is hidden while pointer-locked) --------------------------
const interactRaycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
const crosshair = document.getElementById("crosshair");
const interactHint = document.getElementById("interact-hint");
 
function updateInteractionState() {
  const distance = camera.position.distanceTo(notebook.position);
  const inRange = distance <= NOTEBOOK_INTERACT_DISTANCE;
 
  let looking = false;
  if (inRange) {
    interactRaycaster.setFromCamera(screenCenter, camera);
    const hits = interactRaycaster.intersectObject(notebook, true);
    looking = hits.length > 0;
  }
 
  const canInteract = inRange && looking;
  crosshair.classList.toggle("active", canInteract);
  interactHint.classList.toggle("visible", canInteract);
  return canInteract;
}
 
function tryInteract() {
  if (updateInteractionState()) {
    showMessage(NOTEBOOK_MESSAGE);
  }
}
 
// controls
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());
 
document.body.addEventListener("click", () => {
  if (!controls.isLocked) {
    controls.lock();
    return;
  }
  // already locked -> a click here is a gameplay interaction, not a UI click
  tryInteract();
});
 
// movement
const move = { forward: false, back: false, left: false, right: false };
document.addEventListener("keydown", (e) => {
  if (e.code === "KeyW") move.forward = true;
  if (e.code === "KeyS") move.back = true;
  if (e.code === "KeyA") move.left = true;
  if (e.code === "KeyD") move.right = true;
});
document.addEventListener("keyup", (e) => {
  if (e.code === "KeyW") move.forward = false;
  if (e.code === "KeyS") move.back = false;
  if (e.code === "KeyA") move.left = false;
  if (e.code === "KeyD") move.right = false;
});
 
const SPEED = 6;
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
 
function updateMovement(dt) {
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, camera.up).normalize();
 
  const dir = new THREE.Vector3();
  if (move.forward) dir.add(forward);
  if (move.back) dir.sub(forward);
  if (move.right) dir.add(right);
  if (move.left) dir.sub(right);
  if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(SPEED * dt);
 
  controls.getObject().position.x += dir.x;
  controls.getObject().position.z += dir.z;
}
 
// resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  resizeRenderer();
});
 
// loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (controls.isLocked) {
    updateMovement(dt);
    updateInteractionState();
  } else {
    crosshair.classList.remove("active");
    interactHint.classList.remove("visible");
  }
  camera.position.y = groundHeightAt(camera.position.x, camera.position.z) + 1.7;
  renderer.render(scene, camera);
}
animate();