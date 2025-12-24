import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- 核心配置 ---
const CONFIG = {
    tree: {
        height: 18, // 缩小树的高度
        baseRadius: 7, // 缩小树的底半径
        tiers: 7, 
        particles: 6000, 
        trunkHeight: 3,
        trunkRadius: 0.7
    },
    snow: {
        count: 500,
        bounds: { x: 80, y: 60, z: 80 },
        speedMin: 0.02,
        speedMax: 0.05,
        swayAmplitude: 0.03,
        swayFrequency: 0.4
    },
    interaction: {
        focusScale: 3.2, 
        focusZ: 36, 
        lerpFactor: 0.1,
        hoverScaleMultiplier: 1.3 
    },
    colors: {
        gold: 0xd4af37,
        greens: [0x013220, 0x014421, 0x1a3311, 0x0b2911], 
        red: 0x8a0303,
        love: 0xff0033,
        snow: 0xffffff,
        hoverGlow: 0xfff0a0,
        trunk: 0x2b1e16,
        star: 0xffffcc
    },
    ambient: {
        swayAmount: 0.08,
        swaySpeed: 0.6,
        colorShiftSpeed: 0.3
    }
};

enum Mode {
    TREE = 'tree',
    SCATTER = 'scatter',
    FOCUS = 'focus',
    HEART = 'heart'
}

interface ParticleState {
    pos: THREE.Vector3;
    target: THREE.Vector3;
    scale: THREE.Vector3;
    targetScale: THREE.Vector3;
    type: 'deco' | 'photo' | 'snow' | 'light';
    id: number;
    speed?: number;
    phase?: number;
    flickerSpeed?: number;
    branchAngle?: number; 
}

class Particle {
    mesh: THREE.Mesh | THREE.Sprite;
    state: ParticleState;
    baseScale: number;
    originalColor: THREE.Color;

    constructor(mesh: THREE.Mesh | THREE.Sprite, type: ParticleState['type'], id: number) {
        this.mesh = mesh;
        this.baseScale = mesh.scale.x;
        (this.mesh as any).particle = this;
        
        const mat = (mesh instanceof THREE.Sprite) ? mesh.material : mesh.material;
        const mainMaterial = Array.isArray(mat) ? mat[0] : mat;
        this.originalColor = (mainMaterial as THREE.MeshStandardMaterial).color ? (mainMaterial as THREE.MeshStandardMaterial).color.clone() : new THREE.Color(0xffffff);
        
        this.state = {
            pos: new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60),
            target: new THREE.Vector3(),
            scale: new THREE.Vector3(1, 1, 1),
            targetScale: new THREE.Vector3(1, 1, 1),
            type,
            id,
            phase: Math.random() * Math.PI * 2,
            flickerSpeed: 2 + Math.random() * 5,
            branchAngle: Math.random() * Math.PI * 2
        };

        if (type === 'snow') {
            this.state.pos.set(
                (Math.random() - 0.5) * CONFIG.snow.bounds.x,
                (Math.random() - 0.5) * CONFIG.snow.bounds.y,
                (Math.random() - 0.5) * CONFIG.snow.bounds.z
            );
            this.state.speed = CONFIG.snow.speedMin + Math.random() * (CONFIG.snow.speedMax - CONFIG.snow.speedMin);
        }

        this.mesh.position.copy(this.state.pos);
    }

    update(dt: number, mode: Mode, globalTime: number, isFocused: boolean, isHovered: boolean) {
        if (this.state.type === 'snow') {
            this.state.pos.y -= this.state.speed!;
            this.state.pos.x += Math.sin(globalTime * CONFIG.snow.swayFrequency + this.state.phase!) * CONFIG.snow.swayAmplitude;
            this.state.pos.z += Math.cos(globalTime * CONFIG.snow.swayFrequency * 0.7 + this.state.phase!) * CONFIG.snow.swayAmplitude;
            
            if (this.state.pos.y < -CONFIG.snow.bounds.y / 2) {
                this.state.pos.y = CONFIG.snow.bounds.y / 2;
                this.state.pos.x = (Math.random() - 0.5) * CONFIG.snow.bounds.x;
                this.state.pos.z = (Math.random() - 0.5) * CONFIG.snow.bounds.z;
            }
            this.mesh.position.copy(this.state.pos);
            return;
        }

        const lerpFactor = isFocused ? 0.15 : 0.08;
        const hoverMultiplier = (isHovered && mode !== Mode.FOCUS) ? CONFIG.interaction.hoverScaleMultiplier : 1.0;
        const finalTargetScale = this.state.targetScale.clone().multiplyScalar(hoverMultiplier);
        
        this.state.pos.lerp(this.state.target, lerpFactor);
        this.state.scale.lerp(finalTargetScale, lerpFactor);
        
        this.mesh.position.copy(this.state.pos);
        this.mesh.scale.copy(this.state.scale);

        // --- Subtle Ambient Swaying ---
        if (mode === Mode.TREE && !isFocused) {
            const ambientSway = Math.sin(globalTime * CONFIG.ambient.swaySpeed + this.state.phase!) * CONFIG.ambient.swayAmount;
            const lateralSway = Math.cos(globalTime * CONFIG.ambient.swaySpeed * 0.7 + this.state.phase!) * (CONFIG.ambient.swayAmount * 0.5);
            this.mesh.position.y += ambientSway;
            this.mesh.position.x += lateralSway;
            
            if (this.state.type === 'deco') {
                this.mesh.rotation.z += Math.sin(globalTime * 0.5 + this.state.phase!) * 0.005;
                this.mesh.rotation.x += Math.cos(globalTime * 0.4 + this.state.phase!) * 0.003;
            }
        }

        if (this.state.type === 'light' && mode === Mode.TREE) {
            const flicker = 0.85 + Math.sin(globalTime * this.state.flickerSpeed! + this.state.phase!) * 0.3;
            this.mesh.scale.copy(this.state.scale).multiplyScalar(flicker);
        }

        if (mode === Mode.FOCUS && isFocused) {
            this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, 0, 0.15);
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, 0.15);
            this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, 0.15);
        } else if (mode === Mode.HEART) {
            const beat = 1 + Math.sin(globalTime * 5) * 0.05;
            this.mesh.scale.multiplyScalar(beat);
            // 爱心模式下，由于形状已经是正面的，我们可以稍微减慢旋转
            this.mesh.rotation.y += 0.002;
        } else {
            this.mesh.rotation.y += 0.005;
        }

        const updateMaterial = (m: THREE.Material) => {
            const mat = m as THREE.MeshStandardMaterial;
            if (!mat.isMeshStandardMaterial) return;

            if (isHovered && mode !== Mode.FOCUS) {
                mat.emissive.lerp(new THREE.Color(CONFIG.colors.hoverGlow), 0.1);
                mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 1.2, 0.1);
                mat.color.lerp(new THREE.Color(0xffffff), 0.1);
            } else if (mode === Mode.HEART && this.state.type !== 'photo') {
                mat.color.lerp(new THREE.Color(CONFIG.colors.love), 0.05);
                if (mat.emissive) {
                    mat.emissive.lerp(new THREE.Color(CONFIG.colors.love), 0.05);
                    mat.emissiveIntensity = 0.8;
                }
            } else if (this.state.type === 'light') {
                const shift = (Math.sin(globalTime * CONFIG.ambient.colorShiftSpeed + this.state.phase!) + 1) / 2;
                const warmColor = new THREE.Color(0xfff0a0).lerp(new THREE.Color(0xffcc33), shift);
                mat.emissive.copy(warmColor);
                
                const f = 0.5 + Math.sin(globalTime * 3 + this.state.phase!) * 0.5;
                mat.emissiveIntensity = 1.2 + f * 1.8;
            } else {
                mat.color.lerp(this.originalColor, 0.05);
                if (mat.emissive) {
                    mat.emissive.lerp(new THREE.Color(0x000000), 0.1);
                    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 0, 0.1);
                }
            }
        };

        if (Array.isArray(this.mesh.material)) {
            this.mesh.material.forEach(updateMaterial);
        } else {
            updateMaterial(this.mesh.material);
        }
    }
}

class HolidayApp {
    scene!: THREE.Scene;
    camera!: THREE.PerspectiveCamera;
    renderer!: THREE.WebGLRenderer;
    composer!: EffectComposer;
    mainGroup!: THREE.Group;
    snowGroup!: THREE.Group; 
    landmarker!: HandLandmarker;
    video!: HTMLVideoElement;
    particles: Particle[] = [];
    photoTarget: Particle | null = null;
    hoveredParticle: Particle | null = null;
    mode: Mode = Mode.TREE;
    lastMode: Mode = Mode.TREE;
    time: number = 0;
    hand = { x: 0, y: 0, detected: false, pinching: false };
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    trunk!: THREE.Mesh;
    star!: THREE.Mesh;
    ambientLight!: THREE.AmbientLight;
    sun!: THREE.DirectionalLight;

    constructor() {
        this.initThree();
        this.createContent();
        this.initVision();
        this.initEvents();
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, 50);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 2.2;
        document.body.appendChild(this.renderer.domElement);

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.3, 0.8);
        this.composer.addPass(bloom);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(this.ambientLight);
        this.sun = new THREE.DirectionalLight(0xd4af37, 1.5);
        this.sun.position.set(10, 20, 10);
        this.scene.add(this.sun);

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        this.snowGroup = new THREE.Group();
        this.scene.add(this.snowGroup);
    }

    createContent() {
        const trunkGeo = new THREE.CylinderGeometry(CONFIG.tree.trunkRadius * 0.8, CONFIG.tree.trunkRadius, CONFIG.tree.trunkHeight, 16);
        const trunkMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.trunk, roughness: 1.0, metalness: 0.1 });
        this.trunk = new THREE.Mesh(trunkGeo, trunkMat);
        this.trunk.position.y = -CONFIG.tree.height / 2 - CONFIG.tree.trunkHeight / 2 + 1.5;
        this.mainGroup.add(this.trunk);

        const starShape = new THREE.OctahedronGeometry(1.2, 0);
        const starMat = new THREE.MeshStandardMaterial({ 
            color: CONFIG.colors.star, 
            emissive: CONFIG.colors.star, 
            emissiveIntensity: 3,
            metalness: 1,
            roughness: 0.05
        });
        this.star = new THREE.Mesh(starShape, starMat);
        this.star.position.y = CONFIG.tree.height / 2 + 0.8;
        this.mainGroup.add(this.star);

        const needleGeo = new THREE.BoxGeometry(0.5, 0.08, 0.04);
        const sphereGeo = new THREE.SphereGeometry(0.25, 12, 12);
        const lightGeo = new THREE.SphereGeometry(0.15, 12, 12);
        
        const goldMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 0.9, roughness: 0.15 });
        const greenMats = CONFIG.colors.greens.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 }));
        const redMat = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, clearcoat: 1.0 });
        const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff0a0, emissive: 0xfff0a0, emissiveIntensity: 2.5 });
        
        const snowTex = this.createSnowTexture();
        const snowMat = new THREE.SpriteMaterial({ map: snowTex, transparent: true, opacity: 0.75, depthWrite: false });

        for (let i = 0; i < CONFIG.tree.particles; i++) {
            const r = Math.random();
            let type: ParticleState['type'] = 'deco';
            let geo, mat;

            if (r < 0.82) {
                geo = needleGeo;
                mat = greenMats[Math.floor(Math.random() * greenMats.length)].clone();
                type = 'deco';
            } else if (r < 0.90) {
                geo = lightGeo;
                mat = lightMat.clone();
                type = 'light';
            } else {
                geo = sphereGeo;
                mat = Math.random() > 0.6 ? goldMat.clone() : redMat.clone();
                type = 'deco';
            }

            const mesh = new THREE.Mesh(geo, mat);
            const p = new Particle(mesh, type, i);
            this.particles.push(p);
            this.mainGroup.add(mesh);
        }

        for (let i = 0; i < CONFIG.snow.count; i++) {
            const sprite = new THREE.Sprite(snowMat);
            const scale = 0.15 + Math.random() * 0.25;
            sprite.scale.set(scale, scale, 1);
            const p = new Particle(sprite, 'snow', this.particles.length);
            this.particles.push(p);
            this.snowGroup.add(sprite);
        }

        this.updateLayout();
    }

    createSnowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.7)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    addPhoto(tex: THREE.Texture) {
        const photoGeo = new THREE.BoxGeometry(4, 3, 0.12);
        const frameMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 0.8, roughness: 0.2 });
        const photoMat = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = new THREE.Mesh(photoGeo, [frameMat, frameMat, frameMat, frameMat, photoMat, frameMat]);
        const p = new Particle(mesh, 'photo', this.particles.length);
        this.particles.push(p);
        this.mainGroup.add(mesh);
        this.updateLayout();
    }

    updateLayout() {
        const photos = this.particles.filter(p => p.state.type === 'photo');
        const deco = this.particles.filter(p => p.state.type !== 'photo' && p.state.type !== 'snow');
        
        this.particles.forEach((p) => {
            if (p.state.type === 'snow') return;

            switch (this.mode) {
                case Mode.TREE:
                    if (p.state.type === 'photo') {
                        const idx = photos.indexOf(p);
                        const progress = idx / photos.length;
                        const y = progress * (CONFIG.tree.height * 0.7) - CONFIG.tree.height * 0.35;
                        const angle = progress * Math.PI * 8; 
                        const hRatio = (y + CONFIG.tree.height * 0.5) / CONFIG.tree.height;
                        const scallop = 1 + 0.15 * Math.sin(hRatio * Math.PI * CONFIG.tree.tiers);
                        const r = CONFIG.tree.baseRadius * (1 - hRatio) * scallop + 1.8;
                        p.state.target.set(Math.cos(angle)*r, y, Math.sin(angle)*r);
                        p.state.targetScale.set(0.35, 0.35, 0.35);
                        p.mesh.lookAt(new THREE.Vector3(Math.cos(angle)*(r+5), y, Math.sin(angle)*(r+5)));
                    } else {
                        const idx = deco.indexOf(p);
                        const t = idx / deco.length;
                        const yBase = t * CONFIG.tree.height - CONFIG.tree.height * 0.5;
                        const y = yBase + (Math.random() - 0.5) * 0.5;
                        const hRatio = t;
                        const scallop = 1 + 0.25 * Math.sin(hRatio * Math.PI * CONFIG.tree.tiers);
                        const rBase = CONFIG.tree.baseRadius * (1 - Math.pow(hRatio, 1.1)) * scallop;
                        const angle = p.state.branchAngle!;
                        const r = rBase * (0.05 + Math.random() * 0.95);
                        p.state.target.set(Math.cos(angle)*r, y, Math.sin(angle)*r);
                        const targetLook = new THREE.Vector3(Math.cos(angle)*(r+5), y - 1.2, Math.sin(angle)*(r+5));
                        p.mesh.lookAt(targetLook);
                        const s = 0.8 + Math.random() * 0.4;
                        p.state.targetScale.set(s, s, s);
                    }
                    break;

                case Mode.HEART:
                    const st = Math.random() * Math.PI * 2;
                    // 使用心形参数方程：x = 16sin^3(t), y = 13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)
                    // 转换垂直角度：将计算结果映射到 XY 平面（正对屏幕）
                    const hx = 16 * Math.pow(Math.sin(st), 3) * 0.65;
                    const hy = (13 * Math.cos(st) - 5 * Math.cos(2*st) - 2 * Math.cos(3*st) - Math.cos(4*st)) * 0.65;
                    const hz = (Math.random() - 0.5) * 4; // Z轴代表厚度

                    if (p.state.type === 'photo') {
                        const idx = photos.indexOf(p);
                        const pAngle = (idx / photos.length) * Math.PI * 2;
                        // 照片环绕在立起来的心形周围
                        p.state.target.set(Math.cos(pAngle)*18, 6 + Math.sin(pAngle)*14, Math.sin(pAngle)*5);
                        p.state.targetScale.set(0.65, 0.65, 0.65);
                        p.mesh.lookAt(new THREE.Vector3(0, 6, 0));
                    } else {
                        // yOffset 设为 6 让心形中心大概位于树的中间高度
                        p.state.target.set(hx, hy + 6, hz);
                        p.state.targetScale.set(1.1, 1.1, 1.1);
                        p.mesh.rotation.set(0, 0, 0); // 让装饰物正对
                    }
                    break;

                case Mode.FOCUS:
                    if (p === this.photoTarget) {
                        p.state.target.set(0, 2, CONFIG.interaction.focusZ);
                        p.state.targetScale.set(CONFIG.interaction.focusScale, CONFIG.interaction.focusScale, CONFIG.interaction.focusScale);
                        p.mesh.rotation.set(0, 0, 0);
                    } else {
                        const dist = 45 + Math.random() * 25;
                        const phi = Math.random() * Math.PI * 2;
                        const theta = Math.random() * Math.PI;
                        p.state.target.set(Math.cos(phi)*Math.sin(theta)*dist, Math.sin(phi)*Math.sin(theta)*dist, Math.cos(theta)*dist);
                        p.state.targetScale.set(0.04, 0.04, 0.04);
                    }
                    break;

                case Mode.SCATTER:
                    const sDist = 20 + Math.random() * 15;
                    p.state.target.set((Math.random()-0.5)*sDist*2.1, (Math.random()-0.5)*sDist*2.1, (Math.random()-0.5)*sDist*2.1);
                    p.state.targetScale.set(1, 1, 1);
                    break;
            }
        });
    }

    async initVision() {
        try {
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            this.landmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
                runningMode: "VIDEO", numHands: 1
            });
            this.video = document.getElementById('vision-feed') as HTMLVideoElement;
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            this.video.srcObject = stream;
        } catch(e) { console.warn("Vision Init Failed", e); }
        document.getElementById('loader')?.classList.add('fade-out');
        setTimeout(() => document.getElementById('loader')?.remove(), 1000);
    }

    initEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });

        window.addEventListener('keydown', e => {
            if (e.key.toLowerCase() === 'h') document.getElementById('hud-layer')?.classList.toggle('hud-hidden');
            if (e.key.toLowerCase() === 'l') {
                this.mode = this.mode === Mode.HEART ? Mode.TREE : Mode.HEART;
                this.updateLayout();
            }
        });

        document.getElementById('upload')?.addEventListener('change', (e: any) => {
            Array.from(e.target.files).forEach((f: any) => {
                const r = new FileReader();
                r.onload = ev => new THREE.TextureLoader().load(ev.target?.result as string, t => {
                    t.colorSpace = THREE.SRGBColorSpace;
                    this.addPhoto(t);
                });
                r.readAsDataURL(f);
            });
        });
    }

    processHand() {
        if (!this.landmarker || this.video.readyState < 2) return;
        const result = this.landmarker.detectForVideo(this.video, performance.now());
        const cursor = document.getElementById('smart-cursor');

        if (result.landmarks && result.landmarks.length > 0) {
            this.hand.detected = true;
            if (cursor) cursor.style.display = 'block';

            const lm = result.landmarks[0];
            const indexTip = lm[8];
            const thumbTip = lm[4];
            const wrist = lm[0];

            const screenX = (1 - indexTip.x) * window.innerWidth;
            const screenY = indexTip.y * window.innerHeight;
            this.hand.x += (screenX - this.hand.x) * 0.25;
            this.hand.y += (screenY - this.hand.y) * 0.25;
            
            if (cursor) {
                cursor.style.left = `${this.hand.x}px`;
                cursor.style.top = `${this.hand.y}px`;
            }

            this.mouse.x = (this.hand.x / window.innerWidth) * 2 - 1;
            this.mouse.y = -(this.hand.y / window.innerHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.mainGroup.children, true);
            
            this.hoveredParticle = null;
            if (intersects.length > 0) {
                let obj = intersects[0].object;
                while (obj && !(obj as any).particle && obj.parent && obj.parent !== this.mainGroup) {
                    obj = obj.parent;
                }
                const p = (obj as any).particle as Particle;
                if (p && p.state.type === 'photo') {
                    this.hoveredParticle = p;
                }
            }

            const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
            const isPinching = pinchDist < 0.045;

            if (isPinching && !this.hand.pinching) {
                this.hand.pinching = true;
                if (this.mode !== Mode.FOCUS) {
                    if (this.hoveredParticle) {
                        this.photoTarget = this.hoveredParticle;
                        this.lastMode = this.mode;
                        this.mode = Mode.FOCUS;
                        this.updateLayout();
                        cursor?.classList.add('locked');
                    } else {
                        const photoParticles = this.particles.filter(p => p.state.type === 'photo');
                        if (photoParticles.length > 0) {
                            this.photoTarget = photoParticles[Math.floor(Math.random() * photoParticles.length)];
                            this.lastMode = this.mode;
                            this.mode = Mode.FOCUS;
                            this.updateLayout();
                            cursor?.classList.add('locked');
                        }
                    }
                } else {
                    this.mode = this.lastMode;
                    this.photoTarget = null;
                    this.updateLayout();
                    cursor?.classList.remove('locked');
                }
            } else if (!isPinching) {
                this.hand.pinching = false;
            }

            let avgDist = 0;
            [8, 12, 16, 20].forEach(i => avgDist += Math.hypot(lm[i].x - wrist.x, lm[i].y - wrist.y));
            avgDist /= 4;

            if (avgDist < 0.18 && this.mode === Mode.SCATTER) {
                this.mode = Mode.TREE;
                this.updateLayout();
            } else if (avgDist > 0.45 && this.mode === Mode.TREE) {
                this.mode = Mode.SCATTER;
                this.updateLayout();
            }

            const palm = lm[9];
            if (this.mode !== Mode.FOCUS) {
                this.mainGroup.rotation.y = THREE.MathUtils.lerp(this.mainGroup.rotation.y, (palm.x - 0.5) * 0.8, 0.05);
                this.mainGroup.rotation.x = THREE.MathUtils.lerp(this.mainGroup.rotation.x, (palm.y - 0.5) * 0.5, 0.05);
            } else {
                this.mainGroup.rotation.y = THREE.MathUtils.lerp(this.mainGroup.rotation.y, 0, 0.1);
                this.mainGroup.rotation.x = THREE.MathUtils.lerp(this.mainGroup.rotation.x, 0, 0.1);
            }
        } else {
            this.hand.detected = false;
            this.hoveredParticle = null;
            if (cursor) cursor.style.display = 'none';
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.time += 0.016;
        this.processHand();
        
        if (this.ambientLight) {
            this.ambientLight.intensity = 0.45 + Math.sin(this.time * 0.5) * 0.05;
        }
        if (this.sun) {
            this.sun.position.x = 10 + Math.sin(this.time * 0.3) * 5;
            this.sun.position.z = 10 + Math.cos(this.time * 0.3) * 5;
        }

        this.particles.forEach(p => {
            const isHovered = (p === this.hoveredParticle);
            p.update(0.016, this.mode, this.time, p === this.photoTarget, isHovered);
        });

        if (this.star) {
            this.star.rotation.y += 0.02;
            this.star.visible = (this.mode === Mode.TREE);
        }
        if (this.trunk) {
            this.trunk.visible = (this.mode === Mode.TREE);
        }

        if (!this.hand.detected && this.mode !== Mode.FOCUS) {
            this.mainGroup.rotation.y += 0.005;
        } else if (this.mode === Mode.FOCUS) {
            this.mainGroup.rotation.y = THREE.MathUtils.lerp(this.mainGroup.rotation.y, 0, 0.1);
            this.mainGroup.rotation.x = THREE.MathUtils.lerp(this.mainGroup.rotation.x, 0, 0.1);
        }

        this.composer.render();
    }
}

new HolidayApp();