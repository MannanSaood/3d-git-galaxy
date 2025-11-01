import * as THREE from 'three';

export const addAtmosphericEffects = (scene: THREE.Scene) => {
  const particleCount = 10000;
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 100;
  }

  const particlesGeometry = new THREE.BufferGeometry();
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const particlesMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.1,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.5,
  });

  const particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);

  return { particles };
};


export const animateAtmosphericEffects = (particles: THREE.Points | null, elapsedTime: number) => {
    if (particles) {
        particles.rotation.y = elapsedTime * 0.02;
        particles.rotation.x = elapsedTime * 0.01;
    }
}