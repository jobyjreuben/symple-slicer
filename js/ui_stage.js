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

function Stage() {
    var mine = this;

    // Private:

    this.printer = {
        circular:          false,
        origin_at_center:  false,
        x_width:           300,
        y_depth:           300,
        z_height:          300
    };

    var objects = [];
    var printerRepresentation = new PrinterRepresentation(this.printer);
    var bedRelative = printerRepresentation.bedRelative;
    var selectedGroup = new SelectionGroup();
    var dragging, packer;

    this.onObjectTransformed = function() {
        dropObjectToFloor(selectedGroup);
        dragging = true;
    }

    /**
     * Returns the bounding sphere of an object in bed coordinates
     */
    function getObjectBoundingSphere(object) {
        var sphere = object.geometry.boundingSphere.clone();
        localToBed(object, sphere.center);
        return sphere;
    }

    /**
     * Positions an object in the center of the bed. If fudge
     * is non-zero, it adds a random element to the position
     * in order to aid with the packing algorithm
     */
    function centerObjectOnPlatform(object, fudge) {
        var sphere = object.geometry.boundingSphere;
        var vector = new THREE.Vector3();
        var delta = localToBed(object, vector.copy(sphere.center));
        if(!mine.printer.origin_at_center) {
            delta.x -= mine.printer.x_width/2;
            delta.y -= mine.printer.y_depth/2;
        }
        object.position.x -= delta.x;
        object.position.y -= delta.y;
        if(fudge) {
            object.position.x += (Math.random() - 0.5) * fudge;
            object.position.y += (Math.random() - 0.5) * fudge;
        }
    }

    function arrangeObjectsOnPlatform() {
        if(packer) packingFinished();
        
        selectNone();

        var circles = [];

        // Create an array of circles for the packing algorithm

        for(const [index, object] of objects.entries()) {
            var sphere = getObjectBoundingSphere(object);
            var circle = {
                id:       'c' + index,
                radius:   sphere.radius,
                position: {x: sphere.center.x, y: sphere.center.y},
            };
            if(mine.printer.origin_at_center) {
                // The circle packing algorithm works only with positive coordinates,
                // so shift the coordinate system.
                circle.position.x += mine.printer.x_width/2;
                circle.position.y += mine.printer.y_depth/2;
            }
            circles.push(circle);
        }

        // Function for repositioning the objects on the bed

        function packingUpdate(updatedCircles) {
            for (let id in updatedCircles) {
                const index = parseInt(id.substring(1));
                const object = objects[index];
                const circle = updatedCircles[id];
                object.position.x += circle.delta.x;
                object.position.y += circle.delta.y;
            }
            mine.render();
        };
        
        function packingFinished() {
            packer.destroy();
            packer = null;
        };

        // Run the packing algorithm

        packer = new CirclePacker({
            target:               {x:     mine.printer.x_width/2, y:      mine.printer.y_depth/2},
            bounds:               {width: mine.printer.x_width,   height: mine.printer.y_depth  },
            circles,
            continuousMode:       true,
            collisionPasses:       5,
            centeringPasses:       3,
            onMove:               packingUpdate,
            onMoveEnd:            packingFinished
        });
        packer.update();
    }

    /**
     * Converts a vector in object coordinates to print bed
     * coordinates
     */
    function localToBed(child, vector) {
        bedRelative.worldToLocal(child.localToWorld(vector));
        return vector;
    }

    /**
     * Helper function for finding the point in an object closest
     * to the print bed.
     *
     *  vector       - Scratch Vector3 for use in computation
     *  object       - Parent object for geometry
     *  geometry     - Geometry to tranverse
     *  lowestPoint - Pass result from previous call to continue search
     */
    function findLowestPoint(vector, object, geometry, lowestPoint) {
        geometry.vertices.forEach(function(v, i) {
            localToBed(object, vector.copy(v));
            if (!lowestPoint) {
                lowestPoint = {object: object, vertex: v, index: i, z: vector.z};
            } else {
                localToBed(object, vector.copy(v));
                if(vector.z < lowestPoint.z) {
                    lowestPoint.object = object;
                    lowestPoint.vertex = v;
                    lowestPoint.index  = i;
                    lowestPoint.z      = vector.z;
                }
            }
        });
        return lowestPoint;
    }

    /**
     * Drops an object so it touches the print platform
     */
    function dropObjectToFloor(obj) {
        obj.updateMatrixWorld();
        var lowestPoint;
        var vector = new THREE.Vector3();
        obj.traverse(function(child) {
            if (child instanceof THREE.Mesh) {
                lowestPoint = findLowestPoint(vector, child, child.hull, lowestPoint);
            }
        });
        obj.position.z -= lowestPoint.z;
    }

    /**
     * Lays an object flat on the print bed
     */
    function layObjectFlat(obj) {
        selectNone();

        var vector = new THREE.Vector3();
        var quaternion = new THREE.Quaternion();

        // Step 1: Find the lowest point in the convex hull
        var pivot = findLowestPoint(vector, obj, obj.hull);

        // Step 2: Obtain the world quaternion of the object
        obj.matrixWorld.decompose( vector, quaternion, vector );

        // Step 3: For all faces that share this vertex, compute the angle of that face to the horizontal.
        var downVector = new THREE.Vector3(0, -1, 0);
        var candidates = [];
        obj.hull.faces.forEach((face) => {
            if(pivot.index == face.a ||
               pivot.index == face.b ||
               pivot.index == face.c) {
                   // Rotate face normal into world coordinates and
                   // find the angle between it and the world down vector
                   vector.copy(face.normal);
                   vector.applyQuaternion(quaternion);
                   candidates.push({
                        angle:  Math.acos(vector.dot(downVector)),
                        normal: face.normal
                   });
               }
        });

        // Step 4: Find the normal which is closest to horizontal
        candidates.sort(function(a, b){return a.angle-b.angle});

        // Step 5: Transform the downVector into object coordinates
        downVector.applyQuaternion(quaternion.inverse());

        /*var arrowHelper = new THREE.ArrowHelper( downVector, new THREE.Vector3(), 100 );
        obj.add( arrowHelper );

        var arrowHelper = new THREE.ArrowHelper( vector, new THREE.Vector3(), 100 );
        obj.add( arrowHelper );*/

        // Step 6: Rotate object so that the face normal and down vector are aligned.
        // This causes the object to "layflat" on that face.
        quaternion.setFromUnitVectors(candidates[0].normal, downVector);
        obj.quaternion.multiply(quaternion);

        // Step 7: Bring the object down to the print plate
        dropObjectToFloor(obj);
        mine.render();
    }

    function onLayFlatClicked() {
        selectedGroup.children.forEach(layObjectFlat);
    }

    function addObjectToSelection(obj) {
        bedRelative.add(selectedGroup);
        selectedGroup.addToSelection(obj);
        outlinePass.selectedObjects = [selectedGroup];
        mine.transformControl.attach(selectedGroup);
        mine.render();
    }

    function selectNone() {
        selectedGroup.selectNone();
        outlinePass.selectedObjects = [];
        mine.transformControl.detach();
        mine.render();
    }

    /********************** PUBLIC METHODS **********************/

    this.onTranformToolChanged = function(tool) {
        this.transformControl.enabled = false;
        selectedGroup.recompute();
        this.currentTool = tool;
        switch(tool) {
            case "move":    this.transformControl.setMode("translate"); break;
            case "rotate":  this.transformControl.setMode("rotate"); break;
            case "scale":   this.transformControl.setMode("scale"); break;
            case "mirror":  this.transformControl.setMode("translate"); break;
            case "layflat": onLayFlatClicked(); break;
        }
        this.transformControl.enabled = true;
    }

    this.onObjectClicked = function(obj) {
        addObjectToSelection(obj);
    }

    this.onFloorClicked = function(obj) {
        selectNone();
    }

    this.onMouseDown = function( raycaster, scene ) {
        dragging = false;
    }

    /**
     * This method is called when the user clicks on an object.
     * It evaluates the intersections from the raycaster and
     * determines what to do.
     */
    this.onMouseUp = function( raycaster, scene ) {
        if(dragging) return;
        var intersects = raycaster.intersectObject( scene, true );
        for (var i = 0; i < intersects.length; i++) {
            var obj = intersects[ i ].object;
            if (obj instanceof THREE.TransformControlsPlane) {
                // Disregard clicks on the control object
                continue;
            }
            if (obj instanceof PrintableObject) {
                this.onObjectClicked(obj);
                return;
            }
            // Stop on first intersection
            break;
        }
        // If nothing selected
        this.onFloorClicked();
    }

    this.onViewChanged = function() {
        dragging = true;
    }

    this.getPrinterRepresentation = function() {
        return printerRepresentation;
    }

    /**
     * This function returns a list of ready to slice geometries with
     * all the transformations already baked in.
     */
    this.getAllGeometry = function() {
        return objects.map(obj => {
            var geometry = obj.geometry.clone();
            var transform = obj.matrixWorld.clone();
            var worldToPrinterRepresentation = new THREE.Matrix4();
            transform.premultiply(worldToPrinterRepresentation.getInverse(bedRelative.matrixWorld));
            geometry.applyMatrix(transform);
            geometry.computeBoundingBox();
            console.log(geometry.boundingBox);
            return geometry;
        });
    }

    this.addGeometry = function(geometry) {
        var obj = new PrintableObject(geometry);
        objects.push(obj);
        bedRelative.add(obj);
        dropObjectToFloor(obj);
        centerObjectOnPlatform(obj, 1);
        arrangeObjectsOnPlatform();
        this.render();
    }

    this.removeObjects = function() {
        selectNone();
        objects.forEach(obj => {bedRelative.remove(obj);});
        objects = [];
        this.render();
    }

    this.addEdges = function(edges) {
        bedRelative.add(model);
    }

    /**
     * Attaches a special handler for the TransformControl. Since the control
     * does not have a "mirror" mode, we use a custom "mouseDown" handler to
     * modify the behavior of the "translate" mode to act as if it were a
     * "mirror".
     */
    this.setTransformControl = function(control) {
        this.transformControl = control;
        this.transformControl.space = "local";

        this.transformControl.addEventListener( 'mouseDown', function ( event ) {
            if(mine.currentTool == "mirror") {
                mine.transformControl.dragging = false;
                switch(mine.transformControl.axis) {
                    case 'X': selectedGroup.scale.x = selectedGroup.scale.x < 0 ? 1 : -1; break;
                    case 'Y': selectedGroup.scale.y = selectedGroup.scale.y < 0 ? 1 : -1; break;
                    case 'Z': selectedGroup.scale.z = selectedGroup.scale.z < 0 ? 1 : -1; break;
                }
            }
        } );
    }
}