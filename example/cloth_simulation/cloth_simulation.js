"use strict";

// Cloth simulation based on Mosegaards Cloth Simulation Coding Tutorial
// http://cg.alexandra.dk/2009/06/02/mosegaards-cloth-simulation-coding-tutorial/

var engine,
    vec3 = KICK.math.vec3,
    vec4 = KICK.math.vec4,
    DAMPING = 0.01, // how much to damp the cloth simulation each frame
    TIME_STEPSIZE2  = 0.5*0.5, // how large time step each particle takes each frame
    CONSTRAINT_ITERATIONS = 4,
    ball_radius = 2, // the radius of our one ball
    vec3Zero = [0,0,0], // how many iterations of constraint satisfaction each frame (more is rigid, less is soft);
    gravityForce = vec3.create([0,-0.2*TIME_STEPSIZE2,0]),
    windForce = vec3.create([0.2*TIME_STEPSIZE2,0,0.05*TIME_STEPSIZE2]);
function initKick() {
    engine = new KICK.core.Engine('canvas',{
        enableDebugContext: true
    });
    buildScene();
}

function buildScene(){
    var scene = engine.activeScene;
    var cameraGO = scene.createGameObject({name:"Camera"});
    var camera = new KICK.scene.Camera({
        fieldOfView: 80
    });
    camera.clearColor = [0.2, 0.2, 0.4, 1];
    cameraGO.addComponent(camera);
    var cameraTransform = cameraGO.transform;
    cameraTransform.localPosition = [6.5,-5.5,29.0];
    cameraTransform.localRotationEuler = [0,6,0];

    // add light on scene
    var lightGO = scene.createGameObject({name:"Light"});
    var light = new KICK.scene.Light({
        type:KICK.core.Constants._LIGHT_TYPE_DIRECTIONAL,
        color: [1.0,1.0,1.0,1]
    });
    lightGO.addComponent(light);
    lightGO.transform.localRotation = [0,90,0];

    var lightAmbient = new KICK.scene.Light({
        type:KICK.core.Constants._LIGHT_TYPE_AMBIENT,
        color: [0.1,0.1,0.1,1]
    });
    lightGO.addComponent(lightAmbient);

    var ballGO = scene.createGameObject({name:"Ball"});
    var ballMeshRenderer = new KICK.scene.MeshRenderer();
    ballMeshRenderer.mesh = new KICK.mesh.Mesh(engine,
        {
            dataURI:"kickjs://mesh/uvsphere/?slices=25&stacks=50&radius="+(ball_radius-0.2),
            name:"Default object"
        });
    var shader = engine.project.load(engine.project.ENGINE_SHADER_PHONG);
    ballMeshRenderer.material = new KICK.material.Material(engine, {
        shader:shader,
        uniforms:{
            mainColor:{
                value:[0.4,0.8,0.5,1.0],
                type:KICK.core.Constants.GL_FLOAT_VEC3
            },
            mainTexture:{
                value:engine.project.load(engine.project.ENGINE_TEXTURE_WHITE),
                type:KICK.core.Constants.GL_SAMPLER_2D
            }
        }
    });
    ballGO.addComponent(ballMeshRenderer);
    ballGO.addComponent(new BallUpdater());

    var clothGO = scene.createGameObject({name:"Cloth"});
    clothGO.addComponent(new ClothComponent(14,10,13,13));
    var clothMeshRenderer = new KICK.scene.MeshRenderer();
    clothMeshRenderer.material = new KICK.material.Material(engine, {
        shader:shader,
        uniforms:{
            mainColor:{
                value:[1.0,1.0,1.0,1.0],
                type:KICK.core.Constants.GL_FLOAT_VEC3
            },
            mainTexture:{
                value:engine.project.load(engine.project.ENGINE_TEXTURE_WHITE),
                type:KICK.core.Constants.GL_SAMPLER_2D
            }
        }
    });
    clothGO.addComponent(clothMeshRenderer);
}

function BallUpdater(){
    var time,
        thisObj = this,
        thisTransform,
        ballPosition = [7,-5,0],
        ball_time = 0;

    this.activated = function(){
        time = thisObj.gameObject.engine.time;
        thisTransform = thisObj.gameObject.transform;
    };

    this.update = function(){
        ballPosition[2] = Math.cos(ball_time++/50.0)*7;
        thisTransform.position = ballPosition;
    };
}

var Particle = function (newPos){
    var floatSubArray = new Float32Array(Particle.FLOAT_ELEMENTS),
        pos = floatSubArray.subarray(2,5), // the current position of the particle in 3D space
        old_pos = floatSubArray.subarray(5,8), // the position of the particle in the previous time step, used as part of the verlet numerical integration scheme
        acceleration = floatSubArray.subarray(8,11), // a vector representing the current acceleration of the particle
        accumulated_normal = floatSubArray.subarray(11,14),
        temp = floatSubArray.subarray(14,17),
        temp2 = floatSubArray.subarray(17,20),
        thisObj = this; // an accumulated normal (i.e. non normalized), used for OpenGL soft shading

    // The reason to use properties this way is to maintain the original memory layout
    Object.defineProperties(this,{
        movable:{
            get:function(){
                return floatSubArray[0];
            },
            set:function(newValue){
                floatSubArray[0] = newValue;
            }
        },
        mass:{
            get:function(){
                return floatSubArray[1];
            },
            set:function(newValue){
                floatSubArray[1] = newValue;
            }
        },
        pos:{
            get:function(){
                return pos;
            },
            set:function(newValue){
                vec3.set(newValue,pos);
            }
        },
        old_pos:{
            get:function(){
                return old_pos;
            },
            set:function(newValue){
                vec3.set(newValue,old_pos);
            }
        },
        acceleration:{
            get:function(){
                return acceleration;
            },
            set:function(newValue){
                vec3.set(newValue,acceleration);
            }
        },
        accumulated_normal:{
            get:function(){
                return accumulated_normal;
            },
            set:function(newValue){
                vec3.set(newValue,accumulated_normal);
            }
        }
    });

    /**
     *
     * @param {vec3} f
     */
    this.addForce = function(f){
        var invMass = 1/thisObj.mass;
        vec3.scale(f,invMass,temp);
        vec3.add(acceleration,temp,acceleration);
    };

    /* This is one of the important methods, where the time is progressed a single step size (TIME_STEPSIZE)
       The method is called by Cloth.time_step()
       Given the equation "force = mass * acceleration" the next position is found through verlet integration*/
    this.timeStep = function(){
        if (thisObj.movable){
            /*
            Vec3 temp = pos;
            pos = pos + (pos-old_pos)*(1.0-DAMPING) + acceleration*TIME_STEPSIZE2;
            old_pos = temp;
            acceleration = Vec3(0,0,0); // acceleration is reset since it HAS been translated into a change in position (and implicitely into velocity)
            * */
            vec3.set(pos,temp2);

            vec3.subtract(pos,old_pos,temp);
            vec3.scale(temp,1-DAMPING);
            vec3.add(pos,temp); // first part: + (pos-old_pos)*(1.0-DAMPING)
            vec3.scale(acceleration,TIME_STEPSIZE2,temp);
            vec3.add(pos,temp); // second part: + acceleration*TIME_STEPSIZE2

            vec3.set(temp2,old_pos);
            vec3.set(vec3Zero,acceleration);
        }
    };

    this.resetAcceleration = function(){
        // acceleration = Vec3(0,0,0);
        vec3.set(vec3Zero,acceleration);
    };

    /**
     * @param {vec3} v
     */
    this.offsetPos = function(v) {
        if(thisObj.movable) {
            // if(movable) pos += v;
            vec3.add(pos,v);
        }
    };

    this.makeUnmovable = function() {
        thisObj.movable = false;
    };

    /**
     * @param {Vec3} normal
     */
    this.addToNormal = function(normal){
        // accumulated_normal += normal.normalized();
        vec3.normalize(normal,temp);
        vec3.add(accumulated_normal,temp,accumulated_normal);
    };

    this.normalize = function(){
        vec3.normalize(accumulated_normal);
    };

    this.resetNormal = function(){
        vec3.set(vec3Zero,accumulated_normal);
    };

    (function constructor(){
        if (newPos){
            thisObj.pos = newPos;
            thisObj.old_pos = newPos;
            thisObj.acceleration = [0,0,0];
            thisObj.mass = 1;
            thisObj.movable = 1;
            thisObj.accumulated_normal = [0,0,0];
        }
    })();
    Object.freeze(this);
};

Particle.FLOAT_ELEMENTS = 20;

/**
 * p1/p2 the two particles that are connected through this constraint
 * @param {Particle} p1
 * @param {Particle} p2
 */
function Constraint(p1,p2){
    var rest_distance,
        tempVec3 = vec3.create();  // the length between particle p1 and p2 in rest configuration

    (function constructor(){
        var difference = vec3.subtract(p1.pos,p2.pos,vec3.create());
        rest_distance = vec3.length(difference);
    })();

    /**
     * This is one of the important methods, where a single constraint between two particles p1 and p2 is solved
     * the method is called by Cloth.time_step() many times per frame
     */
    this.satisfyConstraint = function(){
        /*
        Vec3 p1_to_p2 = p2->getPos()-p1->getPos(); // vector from p1 to p2
        float current_distance = p1_to_p2.length(); // current distance between p1 and p2
        Vec3 correctionVector = p1_to_p2*(1 - rest_distance/current_distance); // The offset vector that could moves p1 into a distance of rest_distance to p2
        Vec3 correctionVectorHalf = correctionVector*0.5; // Lets make it half that length, so that we can move BOTH p1 and p2.
        p1->offsetPos(correctionVectorHalf); // correctionVectorHalf is pointing from p1 to p2, so the length should move p1 half the length needed to satisfy the constraint.
        p2->offsetPos(-correctionVectorHalf); // we must move p2 the negative direction of correctionVectorHalf since it points from p2 to p1, and not p1 to p2.
        */
        vec3.subtract(p2.pos,p1.pos,tempVec3); // vector from p1 to p2
        var current_distance = vec3.length(tempVec3); // current distance between p1 and p2
        vec3.scale(tempVec3,1-rest_distance/current_distance);// The offset vector that could moves p1 into a distance of rest_distance to p2
        vec3.scale(tempVec3,0.5); // Lets make it half that length, so that we can move BOTH p1 and p2.
        p1.offsetPos(tempVec3);
        vec3.scale(tempVec3,-1.0);
        p2.offsetPos(tempVec3);
    };
    Object.freeze(this);
}

/** This is a important constructor for the entire system of particles and constraints
  *
 * @param {Number} width
 * @param {Number} height
 * @param {Number} num_particles_width number of particles in "width" direction
 * @param {Number} num_particles_height number of particles in "height" direction
 */
 function ClothComponent(width, height, num_particles_width, num_particles_height){
    var time,
        thisObj = this,
        ballTransform,
        GRAVITY = vec3.scale(vec3.create([0,-0.2,0]),TIME_STEPSIZE2),
        WIND = vec3.scale(vec3.create([0.5,0,0.2]),TIME_STEPSIZE2),
        // total number of particles is num_particles_width*num_particles_height
        particles = [],// all particles that are part of this cloth
        constraints = [], // all constraints between particles as part of this cloth
        meshData = new KICK.mesh.MeshData(),
        meshRenderer,
        vertices = [],
        normals = [],
        colors = [],
        getParticle = function(x,y){
            return particles[y*num_particles_width + x];
        },
        /**
         * @param {Particle} p1
         * @param {Particle} p2
         */
        makeConstraint = function(p1,p2){
            constraints.push(new Constraint(p1,p2));
        },
        /* A private method used by updateMeshData() and addWindForcesForTriangle() to retrieve the
        	normal vector of the triangle defined by the position of the particles p1, p2, and p3.
        	The magnitude of the normal vector is equal to the area of the parallelogram defined by p1, p2 and p3
        	*/
        calcTriangleNormal = (function(){
            var v1 = vec3.create();
            var v2 = vec3.create();
            return function(p1, p2, p3,dest){
                /**
                 Vec3 pos1 = p1->getPos();
                 Vec3 pos2 = p2->getPos();
                 Vec3 pos3 = p3->getPos();

                 Vec3 v1 = pos2-pos1;
                 Vec3 v2 = pos3-pos1;

                 return v1.cross(v2);
                 */
                var pos1 = p1.pos,
                    pos2 = p2.pos,
                    pos3 = p3.pos;
                v1 = vec3.subtract(pos2,pos1,v1);
                v2 = vec3.subtract(pos3,pos1,v2);
                return vec3.cross(v1,v2,dest);
            }})(),
        /**
         *  A private method used by windForce() to calcualte the wind force for a single triangle
         *	defined by p1,p2,p3
         */
        addWindForcesForTriangle = (function(){
            // create clojure to have private variables
            var normal = vec3.create(),
                d = vec3.create();
            var res = function(p1,p2,p3, direction){
                /**
                 * Vec3 normal = calcTriangleNormal(p1,p2,p3);
                 Vec3 d = normal.normalized();
                 Vec3 force = normal*(d.dot(direction));
                 p1->addForce(force);
                 p2->addForce(force);
                 p3->addForce(force);
                 */
                calcTriangleNormal(p1,p2,p3,normal);
                vec3.normalize(normal,d);
                var force = vec3.scale(normal, vec3.dot(d, direction));
                p1.addForce(force);
                p2.addForce(force);
                p3.addForce(force);
            };
            return res;
        })(),
        /** A private method used by updateMeshData(), that draws a single triangle p1,p2,p3 with a color
         * @param {Particle} p1
        * @param {Particle} p2
        * @param {Particle} p3
        * @param {vec3} color
        * @param {Number} triangleIndex triangle index
        */
        drawTriangle = function(p1, p2, p3, color, triangleIndex){
            var set = function(destArray, newValue, idx){
                for (var i = 0;i<newValue.length;i++){
                    destArray[idx+i] = newValue[i];
                }
            };
            set(vertices,p1.pos,triangleIndex*9);
            set(vertices,p2.pos,triangleIndex*9+3);
            set(vertices,p3.pos,triangleIndex*9+6);

            set(normals,p1.accumulated_normal,triangleIndex*9);
            set(normals,p2.accumulated_normal,triangleIndex*9+3);
            set(normals,p3.accumulated_normal,triangleIndex*9+6);

            set(colors,color,triangleIndex*12);
            set(colors,color,triangleIndex*12+4);
            set(colors,color,triangleIndex*12+8);

            /*
            glColor3fv( (GLfloat*) &color );

            glNormal3fv((GLfloat *) &(p1->getNormal().normalized() ));
            glVertex3fv((GLfloat *) &(p1->getPos() ));
            uv
            glNormal3fv((GLfloat *) &(p2->getNormal().normalized() ));
            glVertex3fv((GLfloat *) &(p2->getPos() ));

            glNormal3fv((GLfloat *) &(p3->getNormal().normalized() ));
            glVertex3fv((GLfloat *) &(p3->getPos() ));
            */
        };

    this.scriptPriority = -1; // invoked after ball update

    (function constructor(){
        particles = new Array(num_particles_width*num_particles_height); //I am essentially using this vector as an array with room for num_particles_width*num_particles_height particles

        /*
        // creating particles in a grid of particles from (0,0,0) to (width,-height,0)
        for(int x=0; x<num_particles_width; x++)
        {
            for(int y=0; y<num_particles_height; y++)
            {
                Vec3 pos = Vec3(width * (x/(float)num_particles_width),
                                -height * (y/(float)num_particles_height),
                                0);
                particles[y*num_particles_width+x]= Particle(pos); // insert particle in column x at y'th row
            }
        }
         */
        // creating particles in a grid of particles from (0,0,0) to (width,-height,0)
        for(var x=0; x<num_particles_width; x++)
        {
            for(var y=0; y<num_particles_height; y++)
            {
                var pos = vec3.create([width * (x/num_particles_width),
                    -height * (y/num_particles_height),
                    0]);
                particles[y*num_particles_width+x]= new Particle(pos); // insert particle in column x at y'th row
            }
        }

        /*
        // Connecting immediate neighbor particles with constraints (distance 1 and sqrt(2) in the grid)
		for(int x=0; x<num_particles_width; x++)
		{
			for(int y=0; y<num_particles_height; y++)
			{
				if (x<num_particles_width-1) makeConstraint(getParticle(x,y),getParticle(x+1,y));
				if (y<num_particles_height-1) makeConstraint(getParticle(x,y),getParticle(x,y+1));
				if (x<num_particles_width-1 && y<num_particles_height-1) makeConstraint(getParticle(x,y),getParticle(x+1,y+1));
				if (x<num_particles_width-1 && y<num_particles_height-1) makeConstraint(getParticle(x+1,y),getParticle(x,y+1));
			}
		}
         */
        // Connecting immediate neighbor particles with constraints (distance 1 and sqrt(2) in the grid)
        for(var x=0; x<num_particles_width; x++)
        {
            for(var y=0; y<num_particles_height; y++)
            {
                if (x<num_particles_width-1) makeConstraint(getParticle(x,y),getParticle(x+1,y));
                if (y<num_particles_height-1) makeConstraint(getParticle(x,y),getParticle(x,y+1));
                if (x<num_particles_width-1 && y<num_particles_height-1) makeConstraint(getParticle(x,y),getParticle(x+1,y+1));
                if (x<num_particles_width-1 && y<num_particles_height-1) makeConstraint(getParticle(x+1,y),getParticle(x,y+1));
            }
        }

        /*
        // Connecting secondary neighbors with constraints (distance 2 and sqrt(4) in the grid)
        for(int x=0; x<num_particles_width; x++)
        {
            for(int y=0; y<num_particles_height; y++)
            {
                if (x<num_particles_width-2) makeConstraint(getParticle(x,y),getParticle(x+2,y));
                if (y<num_particles_height-2) makeConstraint(getParticle(x,y),getParticle(x,y+2));
                if (x<num_particles_width-2 && y<num_particles_height-2) makeConstraint(getParticle(x,y),getParticle(x+2,y+2));
                if (x<num_particles_width-2 && y<num_particles_height-2) makeConstraint(getParticle(x+2,y),getParticle(x,y+2));			}
        }
         */
        // Connecting secondary neighbors with constraints (distance 2 and sqrt(4) in the grid)
        for(var x=0; x<num_particles_width; x++)
        {
            for(var y=0; y<num_particles_height; y++)
            {
                if (x<num_particles_width-2) makeConstraint(getParticle(x,y),getParticle(x+2,y));
                if (y<num_particles_height-2) makeConstraint(getParticle(x,y),getParticle(x,y+2));
                if (x<num_particles_width-2 && y<num_particles_height-2) makeConstraint(getParticle(x,y),getParticle(x+2,y+2));
                if (x<num_particles_width-2 && y<num_particles_height-2) makeConstraint(getParticle(x+2,y),getParticle(x,y+2));			}
        }

        // making the upper left most three and right most three particles unmovable
        for(var i=0;i<3; i++)
        {
            getParticle(0+i ,0).offsetPos(vec3.create([0.5,0.0,0.0])); // moving the particle a bit towards the center, to make it hang more natural - because I like it ;)
            getParticle(0+i ,0).makeUnmovable();

            getParticle(0+i ,0).offsetPos(vec3.create([-0.5,0.0,0.0])); // moving the particle a bit towards the center, to make it hang more natural - because I like it ;)
            getParticle(num_particles_width-1-i ,0).makeUnmovable();
        }
    })();

    /* drawing the cloth as a smooth shaded (and colored according to column) OpenGL triangular mesh
    	Called from the display() method
    	The cloth is seen as consisting of triangles for four particles in the grid as follows:

    	(x,y)   *--* (x+1,y)
    	        | /|
    	        |/ |
    	(x,y+1) *--* (x+1,y+1)

    	*/
    this.updateMeshData = function(){
        // reset normals (which where written to last frame)
		for (var i = particles.length-1;i>=0;i--)
		{
            particles[i].resetNormal();
		}

        /*
        //create smooth per particle normals by adding up all the (hard) triangle normals that each particle is part of
        for(int x = 0; x<num_particles_width-1; x++)
        {
            for(int y=0; y<num_particles_height-1; y++)
            {
                Vec3 normal = calcTriangleNormal(getParticle(x+1,y),getParticle(x,y),getParticle(x,y+1));
                getParticle(x+1,y)->addToNormal(normal);
                getParticle(x,y)->addToNormal(normal);
                getParticle(x,y+1)->addToNormal(normal);

                normal = calcTriangleNormal(getParticle(x+1,y+1),getParticle(x+1,y),getParticle(x,y+1));
                getParticle(x+1,y+1)->addToNormal(normal);
                getParticle(x+1,y)->addToNormal(normal);
                getParticle(x,y+1)->addToNormal(normal);
            }
        }
        */
        //create smooth per particle normals by adding up all the (hard) triangle normals that each particle is part of
        for(var x = 0; x<num_particles_width-1; x++)
        {
            for(var y=0; y<num_particles_height-1; y++)
            {
                var normal = calcTriangleNormal(getParticle(x+1,y),getParticle(x,y),getParticle(x,y+1));
                getParticle(x+1,y).addToNormal(normal);
                getParticle(x,y).addToNormal(normal);
                getParticle(x,y+1).addToNormal(normal);

                normal = calcTriangleNormal(getParticle(x+1,y+1),getParticle(x+1,y),getParticle(x,y+1));
                getParticle(x+1,y+1).addToNormal(normal);
                getParticle(x+1,y).addToNormal(normal);
                getParticle(x,y+1).addToNormal(normal);
            }
        }
        for(var x = 0; x<num_particles_width; x++)
        {
            for(var y=0; y<num_particles_height; y++)
            {
                getParticle(x,y).normalize();
            }
        }

        var color = vec4.create();
        var colorDark = vec4.create([0.6,0.2,0.2,1.0]);
        var colorBright = vec4.create([1.0,1.0,1.0,1.0]);
        var triangleIndex = 0;
        for(var x = 0; x<num_particles_width-1; x++)
        {
            for(var y=0; y<num_particles_height-1; y++)
            {
                if (x%2 ^ y%2) // red and white color is interleaved according to which column number
                    color = colorDark;
                else
                    color = colorBright;

                drawTriangle(getParticle(x+1,y),getParticle(x,y),getParticle(x,y+1),color,triangleIndex);
                triangleIndex ++;
                drawTriangle(getParticle(x+1,y+1),getParticle(x+1,y),getParticle(x,y+1),color,triangleIndex);
                triangleIndex ++;
            }
        }
    };

    this.timeStep = function(){
        for(var j=0; j<CONSTRAINT_ITERATIONS; j++) // iterate over all constraints several times
        {
            for(var i=constraints.length-1;i>=0;i--)
            {
                constraints[i].satisfyConstraint(); // satisfy constraint.
            }
        }

        for(var i=particles.length-1;i>=0;i--)
        {
            particles[i].timeStep(); // calculate the position of each particle at the next time step.
        }
    };

    /* used to add gravity (or any other arbitrary vector) to all particles*/
    this.addForce = function(direction){
        for(var i=particles.length-1;i>=0;i--)
        {
            particles[i].addForce(direction); // add the forces to each particle
        }
    };

    /* used to add wind forces to all particles, is added for each triangle since the final force is proportional to the triangle area as seen from the wind direction*/
    this.windForce = function(direction){
        for(var x = 0; x<num_particles_width-1; x++)
        {
            for(var y=0; y<num_particles_height-1; y++)
            {
                addWindForcesForTriangle(getParticle(x+1,y),getParticle(x,y),getParticle(x,y+1),direction);
                addWindForcesForTriangle(getParticle(x+1,y+1),getParticle(x+1,y),getParticle(x,y+1),direction);
            }
        }
    };

    /* used to detect and resolve the collision of the cloth with the ball.
    This is based on a very simples scheme where the position of each particle is simply compared to the sphere and corrected.
    This also means that the sphere can "slip through" if the ball is small enough compared to the distance in the grid bewteen particles
    */
    this.ballCollision = function(center,radius )
    {
        var v = vec3.create(),
            radiusSqr = radius*radius;
        for(var i = particles.length-1;i>=0;i--)
        {
            vec3.subtract(particles[i].pos,center,v);
            var l = vec3.length(v);
            if ( vec3.lengthSqr(v) < radiusSqr) // if the particle is inside the ball
            {
                particles[i].offsetPos(vec3.scale(vec3.normalize(v),(radius-l))); // project the particle to the surface of the ball
            }
        }
    };

    this.activated = function(){
        time = thisObj.gameObject.engine.time;
        ballTransform = thisObj.gameObject.scene.getGameObjectByName("Ball").transform;
        meshRenderer = thisObj.gameObject.getComponentOfType(KICK.scene.MeshRenderer);
        meshRenderer.mesh = new KICK.mesh.Mesh(engine,{name:"Cloth Mesh"});
        var indices = [];
        var indexCount = (num_particles_width-1)*(num_particles_height-1)*3*2;
        for (var i=0;i<indexCount;i++){
            indices[i] = i;
        }
        meshData.indices = indices;
    };

    this.update = (function(){
        return function(){
            var localPosition = ballTransform.localPosition;

            thisObj.addForce(gravityForce); // add gravity each frame, pointing down
            thisObj.windForce(windForce); // generate some wind each frame
            thisObj.timeStep(); // calculate the particle positions of the next frame
            thisObj.ballCollision(localPosition,ball_radius); // resolve collision with the ball

            thisObj.updateMeshData();
            meshData.vertex = vertices;
            meshData.normal = normals;
            meshData.color = colors;
            if (!meshData.uv1){
                meshData.uv1 = new Float32Array(vertices.length/3*2);
            }
            meshRenderer.mesh.meshData = meshData;
        };
    })();
}

function startSimulation(){
    initKick();
}

function starTest(){
    var p = new Particle(vec3.create([1,2, 3]));
    p.addForce(vec3.create([4,5,6]));
    p.addForce(vec3.create([7,8,9]));
    p.timeStep();
    p.addToNormal(vec3.create([1,2,3]));
    p.addToNormal(vec3.create([7,2,3]));
    console.log("Pos "+vec3.str(p.pos));
    console.log("Nor "+vec3.str(p.accumulated_normal));
    p.addForce(vec3.create([7,8,9]));
    p.resetAcceleration();
    console.log("Acc reset "+vec3.str(p.acceleration));
    p.resetNormal();
    console.log("Nor reset "+vec3.str(p.acceleration));

    var p1 = new Particle (vec3.create([1,2, 3]));
    var p2 = new Particle (vec3.create([13,21, 31]));
    var c = new Constraint (p1,p2);
    p2.pos[2] = 0;
    c.satisfyConstraint();
    console.log("Pos1 "+vec3.str(p1.pos));
    console.log("Pos2 "+vec3.str(p2.pos));



}