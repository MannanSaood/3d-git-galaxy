import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { initScene } from '../lib/three/sceneSetup';
import { buildGraph } from '../lib/three/graphBuilder';
import { addAtmosphericEffects, animateAtmosphericEffects } from '../lib/three/atmosphericEffects';
import { buildPullRequests } from '../lib/three/graphBuilder';
import type { CommitNode, RepoData, Settings, PullRequest } from '../types';

interface GitGalaxyCanvasProps {
  repoData: RepoData;
  onCommitSelect: (commit: { hash: string, node: CommitNode } | null) => void;
  selectedCommit: { hash:string, node: CommitNode } | null;
  filteredAuthor: string | null;
  timelineCommitLimit: number | null;
  settings?: Settings;
  pullRequests?: PullRequest[];
}

const GitGalaxyCanvas: React.FC<GitGalaxyCanvasProps> = ({ 
  repoData, 
  onCommitSelect, 
  selectedCommit,
  filteredAuthor,
  timelineCommitLimit,
  settings = {
    theme: 'cyberpunk',
    bloomStrength: 1.7,
    autoRotateSpeed: 0.1,
  },
  pullRequests = []
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    stars: null as THREE.Points | null,
    commitHashes: [] as string[],
    particles: null as THREE.Points | null,
    camera: null as THREE.PerspectiveCamera | null,
    controls: null as any,
    composer: null as any,
    bloomPass: null as any,
    prGroup: null as THREE.Group | null,
    animatedPRMaterials: [] as THREE.MeshBasicMaterial[],
    isZooming: false,
    zoomTarget: null as THREE.Vector3 | null,
    zoomStartPos: null as THREE.Vector3 | null,
    zoomStartTarget: null as THREE.Vector3 | null,
    zoomStartTime: 0,
    animationFrameId: null as number | null,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
  });

  const updateCommitColors = useCallback(() => {
    const { stars, commitHashes } = stateRef.current;
    if (!stars || !repoData) return;

    const colors = stars.geometry.attributes.color;
    if (!colors) return;
    
    // Update colors
    for (let i = 0; i < commitHashes.length; i++) {
        const currentHash = commitHashes[i];
        const node = repoData[currentHash];
        if (!node) continue;
        
        if (currentHash === selectedCommit?.hash) {
            // Highlight selected: yellow
            colors.setXYZ(i, 1.0, 1.0, 0.0);
        } else if (filteredAuthor && node.author === filteredAuthor) {
            // Filtered author: use branch color or cyan
            if (node.branchColor) {
                const color = new THREE.Color(node.branchColor);
                colors.setXYZ(i, color.r, color.g, color.b);
            } else {
                colors.setXYZ(i, 0.0, 1.0, 1.0); // Cyan
            }
        } else if (filteredAuthor && node.author !== filteredAuthor) {
            // Dimmed: gray
            colors.setXYZ(i, 0.3, 0.3, 0.3);
        } else {
            // Default: white or branch color
            if (node.branchColor) {
                const color = new THREE.Color(node.branchColor);
                colors.setXYZ(i, color.r, color.g, color.b);
            } else {
                colors.setXYZ(i, 1.0, 1.0, 1.0);
            }
        }
    }
    colors.needsUpdate = true;
  }, [repoData, selectedCommit, filteredAuthor]);

  // Update colors in useEffect (like original commit and ConstellationCanvas) - NOT in render loop
  // This prevents bloom accumulation from mid-frame color updates
  useEffect(() => {
    if (stateRef.current.stars) {
      updateCommitColors();
    }
  }, [selectedCommit, filteredAuthor, updateCommitColors]);

  // Update settings dynamically when they change (without rebuilding scene)
  useEffect(() => {
    if (!settings || !stateRef.current.controls || !stateRef.current.bloomPass) return;
    
    stateRef.current.controls.autoRotateSpeed = settings.autoRotateSpeed;
    stateRef.current.bloomPass.strength = settings.bloomStrength;
  }, [settings?.autoRotateSpeed, settings?.bloomStrength]);

  // Only rebuild scene when repoData, theme, or pullRequests change
  useEffect(() => {
    if (!canvasRef.current || !repoData || !settings) return;

    // Clean up previous scene if it exists
    if (stateRef.current.scene && stateRef.current.renderer) {
      // Stop animation
      if (stateRef.current.animationFrameId !== null) {
        cancelAnimationFrame(stateRef.current.animationFrameId);
      }
      
      // Dispose scene
      stateRef.current.scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Group || object instanceof THREE.Sprite) {
          if (object instanceof THREE.Group) {
            object.children.forEach(child => {
              if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                  const material = child.material as THREE.Material | THREE.Material[];
                  if (Array.isArray(material)) {
                    material.forEach(mat => mat.dispose());
                  } else {
                    material.dispose();
                  }
                }
              }
            });
          } else {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              const material = object.material as THREE.Material | THREE.Material[];
              if (Array.isArray(material)) {
                material.forEach(mat => mat.dispose());
              } else {
                material.dispose();
              }
            }
          }
        }
      });
      
      stateRef.current.renderer.dispose();
    }

    // Apply timeline filter if set
    let filteredRepoData = repoData;
    if (timelineCommitLimit !== null) {
      const allHashes = Object.keys(repoData);
      const limitedHashes = allHashes.slice(0, timelineCommitLimit);
      filteredRepoData = {} as RepoData;
      limitedHashes.forEach(hash => {
        filteredRepoData[hash] = repoData[hash];
      });
    }

    const { scene, camera, renderer, controls, composer, handleResize, bloomPass } = initScene(canvasRef.current, settings);
    const { stars } = buildGraph(scene, filteredRepoData, settings);
    
    // Build pull requests if available
    let prGroup: THREE.Group | null = null;
    let animatedPRMaterials: THREE.MeshBasicMaterial[] = [];
    if (pullRequests.length > 0) {
      const prResult = buildPullRequests(scene, pullRequests, filteredRepoData);
      prGroup = prResult.prGroup;
      animatedPRMaterials = prResult.animatedMaterials || [];
    }
    
    // Store bloomPass and controls for dynamic updates
    stateRef.current.bloomPass = bloomPass;
    const { particles } = addAtmosphericEffects(scene);
    
    const commitHashes = Object.keys(filteredRepoData);
    stateRef.current.stars = stars;
    stateRef.current.commitHashes = commitHashes;
    stateRef.current.particles = particles;
    stateRef.current.camera = camera;
    stateRef.current.controls = controls;
    stateRef.current.composer = composer;
    stateRef.current.prGroup = prGroup;
    stateRef.current.animatedPRMaterials = animatedPRMaterials;
    stateRef.current.scene = scene;
    stateRef.current.renderer = renderer;
    
    // Initial color update
    updateCommitColors();
    
    // Function to zoom camera to a specific position
    const zoomToPosition = (targetPos: THREE.Vector3) => {
      if (!controls || !camera) return;
      
      // Disable auto-rotate during zoom
      controls.autoRotate = false;
      
      // Store zoom state
      stateRef.current.isZooming = true;
      stateRef.current.zoomTarget = targetPos.clone();
      stateRef.current.zoomStartPos = camera.position.clone();
      stateRef.current.zoomStartTarget = controls.target.clone();
      stateRef.current.zoomStartTime = Date.now();
    };
    
    // Raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    raycaster.params.Points.threshold = 0.5;

    const onClick = (event: MouseEvent) => {
      if (!canvasRef.current || !stateRef.current.stars) return;

      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObject(stateRef.current.stars);
      
      if (intersects.length > 0) {
        const intersection = intersects[0];
        if (intersection.index !== undefined) {
          const hash = stateRef.current.commitHashes[intersection.index];
          const node = filteredRepoData[hash] || repoData[hash];
          if (node) {
            onCommitSelect({ hash, node });
            // Zoom to the clicked node
            const nodePosition = new THREE.Vector3(...node.pos);
            zoomToPosition(nodePosition);
          }
        }
      } else {
        onCommitSelect(null);
      }
    };

    window.addEventListener('resize', handleResize);
    canvasRef.current.addEventListener('click', onClick);

    const clock = new THREE.Clock();
    const tick = () => {
      const elapsedTime = clock.getElapsedTime();

      // Handle zoom animation
      if (stateRef.current.isZooming && stateRef.current.zoomTarget && stateRef.current.zoomStartPos && stateRef.current.zoomStartTarget) {
        const duration = 1000; // 1 second
        const elapsed = Date.now() - stateRef.current.zoomStartTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Calculate new camera position
        const distance = 3;
        const direction = new THREE.Vector3().subVectors(stateRef.current.zoomStartPos, stateRef.current.zoomTarget).normalize();
        const endPosition = new THREE.Vector3().addVectors(stateRef.current.zoomTarget, direction.multiplyScalar(distance));
        
        if (progress < 1) {
          // Ease out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          
          // Lerp camera position
          camera.position.lerpVectors(stateRef.current.zoomStartPos, endPosition, eased);
          
          // Lerp controls target
          controls.target.lerpVectors(stateRef.current.zoomStartTarget, stateRef.current.zoomTarget, eased);
        } else {
          // Animation complete - ensure controls are updated to final position
          camera.position.copy(endPosition);
          controls.target.copy(stateRef.current.zoomTarget);
          controls.update();
          
          stateRef.current.isZooming = false;
          stateRef.current.zoomTarget = null;
          stateRef.current.zoomStartPos = null;
          stateRef.current.zoomStartTarget = null;
        }
      }

      // Animate PR materials (pulsing for open PRs)
      if (stateRef.current.animatedPRMaterials.length > 0) {
        const time = Date.now() * 0.001;
        stateRef.current.animatedPRMaterials.forEach(material => {
          material.opacity = 0.5 + Math.sin(time * 2) * 0.3;
        });
      }

      if (stateRef.current.particles) {
        animateAtmosphericEffects(stateRef.current.particles, elapsedTime);
      }

      if (stateRef.current.controls) {
        stateRef.current.controls.update();
      }

      if (stateRef.current.composer) {
        stateRef.current.composer.render();
      }

      const frameId = window.requestAnimationFrame(tick);
      stateRef.current.animationFrameId = frameId;
    };

    tick();

    return () => {
      // Stop animation loop
      if (stateRef.current.animationFrameId !== null) {
        cancelAnimationFrame(stateRef.current.animationFrameId);
        stateRef.current.animationFrameId = null;
      }

      window.removeEventListener('resize', handleResize);
      canvasRef.current?.removeEventListener('click', onClick);
      
      // Dispose renderer
      if (stateRef.current.renderer) {
        stateRef.current.renderer.dispose();
      }
      
      // Dispose all scene objects
      if (stateRef.current.scene) {
        stateRef.current.scene.traverse(object => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Group || object instanceof THREE.Sprite) {
            if (object instanceof THREE.Group) {
              object.children.forEach(child => {
                if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
                  if (child.geometry) child.geometry.dispose();
                  if (child.material) {
                    const material = child.material as THREE.Material | THREE.Material[];
                    if (Array.isArray(material)) {
                      material.forEach(mat => mat.dispose());
                    } else {
                      material.dispose();
                    }
                  }
                }
              });
            } else {
              if (object.geometry) object.geometry.dispose();
              if (object.material) {
                const material = object.material as THREE.Material | THREE.Material[];
                if (Array.isArray(material)) {
                  material.forEach(mat => mat.dispose());
                } else {
                  material.dispose();
                }
              }
            }
          }
        });
      }
      
      // Clear references
      stateRef.current.stars = null;
      stateRef.current.particles = null;
      stateRef.current.prGroup = null;
      stateRef.current.animatedPRMaterials = [];
      stateRef.current.scene = null;
      stateRef.current.renderer = null;
    };
  }, [repoData, timelineCommitLimit, settings.theme, pullRequests.length, onCommitSelect]);

  return <canvas ref={canvasRef} className="webgl fixed top-0 left-0 outline-none" />;
};

export default GitGalaxyCanvas;