
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const initScene = (canvas: HTMLCanvasElement) => {
  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 10, 35);

  // Camera
  const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100);
  camera.position.set(0, 5, 15);
  scene.add(camera);

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
  });
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // Post-processing
  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), 1.5, 0.4, 0.05);
  bloomPass.strength = 1.7;
  bloomPass.radius = 0.5;
  bloomPass.threshold = 0.03;

  const composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  // Handle window resizing
  const handleResize = () => {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;

    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    composer.setSize(sizes.width, sizes.height);
  };

  return { scene, camera, renderer, controls, composer, handleResize };
};
