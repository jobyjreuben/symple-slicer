/**
 * WebSlicer
 * Copyright (C) 2020  SynDaver Labs, Inc.
 * Copyright (C) 2016  Marcio Teixeira
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

class PrinterRepresentation extends THREE.Object3D {

    static checkersFragmentShader = `
        varying vec2  vUv;
        uniform float checkSize;
        uniform vec4  color1;
        uniform vec4  color2;

        vec4 checker(in float u, in float v) {
            float fmodResult = mod(floor(checkSize * u) + floor(checkSize * v), 2.0);

            if (fmodResult < 1.0) {
                return color1;
            } else {
                return color2;
            }
        }

        void main() {
            vec2 position = -1.0 + 2.0 * vUv;
            gl_FragColor = checker(vUv.x, vUv.y);
        }
    `;
    
    static checkersVertexShader = `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    
    static checkerboardMaterial = new THREE.ShaderMaterial({
        uniforms: {
            checkSize: { type: "f", value: 15 },
            color1: { type: "v4", value: new THREE.Vector4(0.55, 0.55, 0.55, 1) },
            color2: { type: "v4", value: new THREE.Vector4(0.50, 0.50, 0.50, 1) },
        },
        vertexShader:   PrinterRepresentation.checkersVertexShader,
        fragmentShader: PrinterRepresentation.checkersFragmentShader,
        side: THREE.DoubleSide,
    });
    
    static wireframeMaterial = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2 } );
        
    constructor(printer) {
        super();

        // Set to printer coordinates (Z goes up)
        this.rotateX(-90 * Math.PI / 180);
        this.rotateZ(180 * Math.PI / 180);

        // Print bed representation
        var geometry;
        if (printer.circular) {
            var segments = 64;
             var bed_radius = min(printer.x_width, printer.y_depth);
            geometry = new THREE.CircleBufferGeometry( bed_radius, segments );
        } else {
            geometry = new THREE.PlaneBufferGeometry( printer.x_width, printer.y_depth, 1 );
        }

        // Shadow receiver
        var mesh = new THREE.Mesh( geometry, new THREE.ShadowMaterial({opacity: 0.25}) );
        mesh.position.z = 0.1;
        mesh.receiveShadow = true;
        this.add(mesh);
        var floorPlane = mesh;

        // Checkered floor
        var mesh = new THREE.Mesh( geometry, PrinterRepresentation.checkerboardMaterial );
        mesh.position.z = 0.05;
        this.add(mesh);

        // Walls

        var box = new THREE.BoxGeometry( printer.x_width, printer.y_depth, printer.z_height );
        var edges = new THREE.EdgesGeometry( box );

        var wireframe = new THREE.LineSegments( edges, PrinterRepresentation.wireframeMaterial );
        wireframe.position.z = printer.z_height / 2;
        this.add(wireframe);

        // Light for casting shadows

        var light = new THREE.DirectionalLight( 0xffffff, 0 );
        light.position.set( 0, 0, printer.z_height );
        light.castShadow = true;
        this.add(light);

        light.shadow.camera.left   = -printer.x_width / 2;
        light.shadow.camera.right  =  printer.x_width / 2;
        light.shadow.camera.top    = -printer.y_depth / 2;
        light.shadow.camera.bottom =  printer.y_depth / 2;

        //Set up shadow properties for the light
        light.shadow.mapSize.width  = 512;
        light.shadow.mapSize.height = 512;
        light.shadow.camera.near    = 0;
        light.shadow.camera.far     = printer.z_height + 1;

        this.shadowLight = light;

        // Create a bed relative coordinate system.

        this.bedRelative = new THREE.Object3D();
        if (!printer.origin_at_center) {
            this.bedRelative.position.x -= printer.x_width / 2;
            this.bedRelative.position.y -= printer.y_depth / 2;
        }
        this.bedRelative.add( new THREE.AxesHelper( 25 ) );
        this.add(this.bedRelative);
    }
}