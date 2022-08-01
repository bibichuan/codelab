import store from '@/store';
import * as THREE from 'three';
import { circle as Circle } from '@turf/turf';

export class WallLayer {
    constructor (point,range) {
        this.map=store.state.map;
        let center=this.map.getCenter();
        // 重新设置图层的渲染中心点，将模型等物体的渲染中心点重置
        // 否则和 LOCA 可视化等多个图层能力使用的时候会出现物体位置偏移的问题
        this.customCoords= this.map.customCoords;
        this.customCoords.setCenter(center.pos);

        // 材质
        this.texture=null;
        this.texture_offset=0.01; // 材质偏移量动画
        this.height=1000; // 墙体高度
        this.scene=new THREE.Scene();
        this.color="#ff0000"; // 墙面的颜色

        this.walllayer=null; // 自定义图层
        this.animateId=null; // 动画id
        this.point=point; // 影响中心
        this.range=range; // 影响范围


        // 执行初始化
        this.init_WallLayer();
    }

    init_WallLayer=()=>{
        let that=this;
        var camera;
        var renderer;
        var scene=this.scene;
        
        // 创建 GL 图层
        var gllayer = new AMap.GLCustomLayer({
            // 图层的层级
            zIndex: 200,
            // 初始化的操作，创建图层过程中执行一次。
            init: (gl) => {
                // 这里我们的地图模式是 3D，所以创建一个透视相机，相机的参数初始化可以随意设置，因为在 render 函数中，每一帧都需要同步相机参数，因此这里变得不那么重要。
                // 如果你需要 2D 地图（viewMode: '2D'），那么你需要创建一个正交相机
                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 100, 1 << 30);
                
                renderer = new THREE.WebGLRenderer({
                    context: gl,  // 地图的 gl 上下文
                    // alpha: true,
                    // antialias: true,
                    // canvas: gl.canvas,
                });
                
                // 自动清空画布这里必须设置为 false，否则地图底图将无法显示
                renderer.autoClear = false;
                
                // 环境光照和平行光
                var aLight = new THREE.AmbientLight(0xffffff, 0.3); 
                var dLight = new THREE.DirectionalLight(0xffffff, 1);
                dLight.position.set(1000, -100, 900);
                scene.add(dLight);
                scene.add(aLight);

                // 创建影响范围
                this.createInfluenceRange();

            },
            render: () => {
                // 这里必须执行！！重新设置 three 的 gl 上下文状态。
                renderer.resetState();
              
                var { near, far, fov, up, lookAt, position } = that.customCoords.getCameraParams();


                // 这里的顺序不能颠倒，否则可能会出现绘制卡顿的效果。
                camera.near = near;
                camera.far = far;
                camera.fov = fov;
                camera.position.set(...position);
                camera.up.set(...up);
                camera.lookAt(...lookAt);
                camera.updateProjectionMatrix();
                
                renderer.render(scene, camera);
            
                // 这里必须执行！！重新设置 three 的 gl 上下文状态。
                renderer.resetState();
            },
        });
        that.map.add(gllayer);
        that.walllayer=gllayer;
    }
    /**
     * 获取影响范围路径
     */
    createInfluenceRange(){
        let center=this.point;
        let radius=this.range/1000;
        var options = {steps: 1000, units: 'kilometers'};
        var circle = Circle(center, radius, options);
        let path=circle.geometry.coordinates[0];
        this.createWall(path);
    }
    /**
     * 获取路径
     */
    createDistrict(){
        // 居中最大化
        let districtSearch = new AMap.DistrictSearch({
            // 关键字对应的行政区级别，共有5种级别
            level: 'district',
            //  是否显示下级行政区级数，1表示返回下一级行政区
            subdistrict: 0,
            // 返回行政区边界坐标点
            extensions: 'all',
        })

        // 搜索所有省/直辖市信息
        districtSearch.search('余杭', (status, result) => {
            let bounds = result.districtList[0].boundaries[0];
            let boundsLength=bounds.length;
            let path=[];
            // 计算最大最小范围
            for(let i=boundsLength-1;i>=0;i-- ){
                let item=bounds[i];
                path.push(item.toArray());
            }

            // 根据行政区域范围创建墙
            this.createWall(path);
            
        });
    }

    /**
     * 创建范围墙
     * @param arr {Array} 范围路径, 可以是多个边界数组
     * 比如 [ [[x1,y1],[x2,y2]], [[x3,y3],[x4,y4],[x5,y5]]
     */
    createWall (path) {
        let that=this;
    
        path=that.customCoords.lngLatsToCoords(path); // 将经纬度坐标转换为屏幕坐标
        let paths=[path];

        // 添加墙
        let faceList = []
        let faceVertexUvs = []

        // 合并多个闭合范围
        for (let i = 0; i < paths.length; i++) {
            const { face, uvs } = that.generateVecData(paths[i])
            faceList = [...faceList, ...face]
            faceVertexUvs = [...faceVertexUvs, ...uvs]
        }

        // 垂直墙体A
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faceList), 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(faceVertexUvs), 2))
        // 添加材质
        const material1 = new THREE.MeshBasicMaterial({
            color: that.color,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            alphaMap: new THREE.TextureLoader().load(process.env.VUE_APP_URL+"/static/img/texture/wall.png")
        });
        const mesh1 = new THREE.Mesh(geometry, material1)
        this.scene.add(mesh1);

        // 拷贝垂直墙体A，在相同的位置添加一层垂直墙体B
        const geometry2 = geometry.clone();
        that.texture = that.generateTexture(128, that.color)
        that.texture.wrapS = THREE.RepeatWrapping // 水平重复平铺
        that.texture.wrapT = THREE.RepeatWrapping // 垂直重复平铺

        const material2 = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            map: that.texture
        })
        const mesh2 = new THREE.Mesh(geometry2, material2)
        this.scene.add(mesh2);

        // 启动动画
        that.animateWall();

    }

    /**
     * 创建一个闭合范围的模型数据
     * @param res {Object} 包含面的顶点数据face，UV面的顶点数据uvs
     */
    generateVecData (arr) {
        let height=this.height;
        const vec3List = [] // 顶点数组
        let faceList = [] // 三角面数组
        let faceVertexUvs = [] // 面的UV层队列，用于纹理和几何信息映射

            //UV面的坐标声明
        const t0 = [0, 0]
        const t1 = [1, 0]
        const t2 = [1, 1]
        const t3 = [0, 1]

        for (let i = 0; i < arr.length; i++) {
        const [x1, y1] = arr[i]
        vec3List.push([x1, y1, 0])
        vec3List.push([x1, y1, height])
        }

        for (let i = 0; i < vec3List.length - 2; i++) {
        if (i % 2 === 0) {
            // 下三角顶点
            faceList = [...faceList, ...vec3List[i], ...vec3List[i + 2], ...vec3List[i + 1]]
            // 下三角UV面
            faceVertexUvs = [...faceVertexUvs, ...t0, ...t1, ...t3]
        } else {
            // 上三角顶点
            faceList = [...faceList, ...vec3List[i], ...vec3List[i + 1], ...vec3List[i + 2]]
            // 上三角UV面
            faceVertexUvs = [...faceVertexUvs, ...t3, ...t1, ...t2]
        }
        }

        return {
            face: faceList,
            uvs: faceVertexUvs
        }
    }

    /**
     * 生成材质
     * @param {*} size 
     * @param {*} color 
     * @returns 
     */
    generateTexture(size = 64, color ="#ff0000"){
        let canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        let ctx = canvas.getContext('2d')
        let linearGradient = ctx.createLinearGradient(0,0,0,size)
        linearGradient.addColorStop(0.2, hexToRgba(color, 0.0)) // 将16进制写法转换从rgba写法
        linearGradient.addColorStop(0.8, hexToRgba(color, 0.5))
        linearGradient.addColorStop(1.0, hexToRgba(color, 1.0))
        ctx.fillStyle = linearGradient
        ctx.fillRect(0,0, size, size)
        
        let texture = new THREE.Texture(canvas)
        texture.needsUpdate = true //必须
        return texture
    }

    /**
     * 渲染动画，墙体动画
     * @param {*} map 
     */
    animateWall() {
        let map=this.map;
        this.texture.offset.y-=this.texture_offset; // 偏移量修改
        map.render();
        this.animateId=requestAnimationFrame(()=>{
            this.animateWall();
        });
    }
    /**
     * 清理数据
     */
    clear(){
        if(this.animateId){
            cancelAnimationFrame(this.animateId);
        }
        // 移除图层
        this.map.removeLayer(this.walllayer);
    }

}

/**
 * 将hex转换为rgba
 * @returns 
 */
let reg = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;  
function hexToRgba(color,alpha){
    var sColor = color.toLowerCase();  
    if(sColor && reg.test(sColor)){  
        if(sColor.length === 4){  
            var sColorNew = "#";  
            for(let i=1; i<4; i+=1){  
                sColorNew += sColor.slice(i,i+1).concat(sColor.slice(i,i+1));     
            }  
            sColor = sColorNew;  
        }  
        //处理六位的颜色值  
        let sColorChange = [];  
        for(let i=1; i<7; i+=2){  
            sColorChange.push(parseInt("0x"+sColor.slice(i,i+2)));    
        }  

        //转换为rgba,透明度为传递的参数x；
        return "rgba(" + sColorChange.join(",") + ","+alpha+")";

    }else{  
        return sColor;    
    }  
}