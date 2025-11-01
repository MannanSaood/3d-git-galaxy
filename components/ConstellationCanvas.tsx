import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { ConstellationRepo } from '../types';

interface ConstellationCanvasProps {
  repos: ConstellationRepo[];
  onRepoSelect: (repo: ConstellationRepo) => void;
}

const ConstellationCanvas: React.FC<ConstellationCanvasProps> = ({ repos, onRepoSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    points: null as THREE.Points | null,
    repos: [] as ConstellationRepo[],
    particles: null as THREE.Points | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    controls: null as OrbitControls | null,
    composer: null as EffectComposer | null,
    handleResize: null as (() => void) | null,
  });

  useEffect(() => {
    if (!canvasRef.current || repos.length === 0) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 10, 50);

    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100);
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Post-processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(sizes.width, sizes.height),
      1.5,
      0.4,
      0.05
    );
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

    // Create repository points with random colors
    const positions: number[] = [];
    const colors: number[] = [];
    
    repos.forEach((repo) => {
      positions.push(...repo.pos);
      // Random color for each repo (HSL for better color distribution)
      const hue = Math.random();
      const saturation = 0.7 + Math.random() * 0.3; // 0.7-1.0
      const lightness = 0.5 + Math.random() * 0.3; // 0.5-0.8
      const color = new THREE.Color().setHSL(hue, saturation, lightness);
      colors.push(color.r, color.g, color.b);
    });

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));

    const pointsMaterial = new THREE.PointsMaterial({
      size: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
      vertexColors: true, // Use vertex colors
    });

    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(points);

    // Create connections between nearby repositories
    const connectionGroup = new THREE.Group();
    const maxConnectionDistance = 8; // Maximum distance to connect repos
    
    for (let i = 0; i < repos.length; i++) {
      const repo1 = repos[i];
      const pos1 = new THREE.Vector3(...repo1.pos);
      
      // Connect to nearest neighbors within maxConnectionDistance
      const connections: { repo: ConstellationRepo; distance: number }[] = [];
      
      for (let j = i + 1; j < repos.length; j++) {
        const repo2 = repos[j];
        const pos2 = new THREE.Vector3(...repo2.pos);
        const distance = pos1.distanceTo(pos2);
        
        if (distance <= maxConnectionDistance) {
          connections.push({ repo: repo2, distance });
        }
      }
      
      // Sort by distance and connect to closest 2-3 neighbors
      connections.sort((a, b) => a.distance - b.distance);
      const numConnections = Math.min(connections.length, 2 + Math.floor(Math.random() * 2)); // 2-3 connections
      
      for (let k = 0; k < numConnections; k++) {
        const connectedRepo = connections[k].repo;
        const pos2 = new THREE.Vector3(...connectedRepo.pos);
        
        const curve = new THREE.LineCurve3(pos1, pos2);
        const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.015, 8, false);
        
        // Use a random color for the connection, slightly dimmed
        const connectionColor = new THREE.Color().setHSL(Math.random(), 0.5, 0.4);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: connectionColor,
          transparent: true,
          opacity: 0.6,
        });
        
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        connectionGroup.add(tube);
      }
    }
    
    scene.add(connectionGroup);

    // Atmospheric effects (particles)
    const particleCount = 5000;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
      particlePositions[i] = (Math.random() - 0.5) * 200;
    }

    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particlesMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.3,
    });

    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    stateRef.current.points = points;
    stateRef.current.repos = repos;
    stateRef.current.particles = particles;
    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.renderer = renderer;
    stateRef.current.controls = controls;
    stateRef.current.composer = composer;
    stateRef.current.handleResize = handleResize;

    // Raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    raycaster.params.Points.threshold = 1.0;

    let hoveredIndex: number | null = null;

    const onMouseMove = (event: MouseEvent) => {
      if (!canvasRef.current || !stateRef.current.points || !stateRef.current.camera) return;

      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, stateRef.current.camera);
      const intersects = raycaster.intersectObject(stateRef.current.points);

      if (intersects.length > 0 && intersects[0].index !== undefined) {
        const index = intersects[0].index;
        if (hoveredIndex !== index) {
          hoveredIndex = index;
          const repo = stateRef.current.repos[index];
          if (tooltipRef.current && repo) {
            tooltipRef.current.textContent = repo.name;
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.style.left = `${event.clientX + 10}px`;
            tooltipRef.current.style.top = `${event.clientY + 10}px`;
          }
        }
      } else {
        hoveredIndex = null;
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      }
    };

    const onClick = (event: MouseEvent) => {
      if (!canvasRef.current || !stateRef.current.points || !stateRef.current.camera) return;

      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, stateRef.current.camera);
      const intersects = raycaster.intersectObject(stateRef.current.points);

      if (intersects.length > 0 && intersects[0].index !== undefined) {
        const index = intersects[0].index;
        const repo = stateRef.current.repos[index];
        if (repo) {
          onRepoSelect(repo);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    canvasRef.current.addEventListener('mousemove', onMouseMove);
    canvasRef.current.addEventListener('click', onClick);

    const clock = new THREE.Clock();
    const tick = () => {
      const elapsedTime = clock.getElapsedTime();

      if (stateRef.current.particles) {
        stateRef.current.particles.rotation.y = elapsedTime * 0.01;
        stateRef.current.particles.rotation.x = elapsedTime * 0.005;
      }

      if (stateRef.current.controls) {
        stateRef.current.controls.update();
      }

      if (stateRef.current.composer) {
        stateRef.current.composer.render();
      }

      window.requestAnimationFrame(tick);
    };

    tick();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvasRef.current?.removeEventListener('mousemove', onMouseMove);
      canvasRef.current?.removeEventListener('click', onClick);

      if (stateRef.current.renderer) {
        stateRef.current.renderer.dispose();
      }

      if (stateRef.current.scene) {
        stateRef.current.scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Group) {
            if (object instanceof THREE.Group) {
              object.children.forEach((child) => {
                if (child instanceof THREE.Mesh) {
                  child.geometry.dispose();
                  const material = child.material as THREE.Material | THREE.Material[];
                  if (Array.isArray(material)) {
                    material.forEach((mat) => mat.dispose());
                  } else {
                    material.dispose();
                  }
                }
              });
            } else {
              object.geometry.dispose();
              const material = object.material as THREE.Material | THREE.Material[];
              if (Array.isArray(material)) {
                material.forEach((mat) => mat.dispose());
              } else {
                material.dispose();
              }
            }
          }
        });
      }
    };
  }, [repos, onRepoSelect]);

  return (
    <>
      <canvas ref={canvasRef} className="webgl fixed top-0 left-0 outline-none" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-black/70 backdrop-blur-sm border border-cyan-300/30 rounded px-3 py-2 text-white font-mono text-sm z-50 hidden"
        style={{ display: 'none' }}
      />
    </>
  );
};

export default ConstellationCanvas;

