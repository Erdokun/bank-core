/* Isolated, dependency-free WebGL presentation. It never reads account data. */
(function(){
  'use strict';
  var hero=document.querySelector('.hero');
  if(!hero)return;
  var canvas=document.getElementById('earthCanvas');
  var video=document.getElementById('earthVideo');
  var control=document.getElementById('heroMotion');
  var preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  var paused=preference.matches;
  try{paused=paused||localStorage.getItem('veyra-motion-paused')==='true';}catch(e){}
  var active=!document.body.classList.contains('app-open'),visible=true;
  var gl=null,program=null,texture=null,cloudTexture=null,buffer=null,uniforms=null;
  var frame=0,lastFrame=0,elapsed=0,ready=false,generation=0;
  var pointer={x:0,y:0},target={x:0,y:0},scroll=0;

  var vertexSource='attribute vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.0,1.0);}';
  var fragmentSource=`
    precision highp float;
    uniform vec2 uSize;
    uniform vec2 uPointer;
    uniform float uTime;
    uniform float uScroll;
    uniform sampler2D uEarth;
    uniform sampler2D uClouds;
    const float PI=3.14159265359;

    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    vec3 stars(vec2 point,float cell,float seed){
      vec2 grid=point/cell;
      vec2 id=floor(grid);
      float chance=hash(id+seed);
      vec2 offset=vec2(hash(id+13.7+seed),hash(id+45.2+seed))*.72+.14;
      float d=length((fract(grid)-offset)*cell);
      float size=mix(.45,1.15,chance);
      float brightness=(1.0-smoothstep(0.0,size,d))*step(.79,chance);
      float twinkle=.78+.22*sin(uTime*.5+chance*40.0);
      return mix(vec3(.52,.67,.88),vec3(.92,.96,1.0),chance)*brightness*twinkle;
    }

    void main(){
      // Orthographic ray/sphere intersection: every visible point has a real
      // surface normal, spherical UVs, a day/night boundary and a lit limb.
      vec2 pixel=gl_FragCoord.xy;
      float pixelRatio=uSize.y/900.0;
      vec2 skyPoint=pixel/max(pixelRatio,.7);
      vec3 sky=vec3(.001,.003,.008);
      sky+=stars(skyPoint+uPointer*3.0,17.0,31.0)*.28;
      sky+=stars(skyPoint+uPointer*8.0,33.0,0.0)*.62;
      sky+=stars(skyPoint+uPointer*17.0,83.0,17.0)*.8;
      vec2 skyUV=pixel/uSize;
      float nebula=exp(-length((skyUV-vec2(.13,.55))*vec2(2.0,1.0))*5.0);
      sky+=vec3(.002,.012,.026)*nebula;

      float radius=max(uSize.x*.57,uSize.y*.89);
      vec2 center=vec2(uSize.x*.5,uSize.y*.46-radius);
      center+=vec2(uPointer.x*10.0,uPointer.y*6.0+uScroll*20.0)*pixelRatio;
      vec2 p=(pixel-center)/radius;
      float distanceToCenter=length(p);
      vec3 color=sky;
      if(distanceToCenter<1.0){
        float z=sqrt(max(0.0,1.0-dot(p,p)));
        vec3 normal=vec3(p,z);
        float tilt=.94+uPointer.y*.025;
        vec3 mapNormal=vec3(normal.x,normal.y*cos(tilt)-normal.z*sin(tilt),normal.y*sin(tilt)+normal.z*cos(tilt));
        float longitude=atan(mapNormal.x,mapNormal.z)/(2.0*PI)+.5;
        float latitude=asin(clamp(mapNormal.y,-1.0,1.0))/PI+.5;
        vec2 uv=vec2(longitude+.04+uTime*.009+uPointer.x*.015,latitude);
        vec3 surface=texture2D(uEarth,uv).rgb;
        vec3 sunlight=normalize(vec3(-.7,.85,1.1));
        float day=max(dot(normal,sunlight),0.0);
        color=surface*(.075+day*1.13);
        vec2 cloudUV=uv+vec2(uTime*.0012,0.0);
        float shadow=texture2D(uClouds,cloudUV+vec2(.003,-.002)).a;
        color*=1.0-shadow*.2;
        float cloud=texture2D(uClouds,cloudUV).a;
        color=mix(color,vec3(.88,.94,1.0)*(.12+day*1.05),cloud*.88);
        // Fresnel scattering creates a blue atmospheric rim without a solid ring.
        float fresnel=pow(1.0-z,3.6);
        color+=vec3(.035,.28,.69)*fresnel*(.55+day*.6);
        color*=1.0-smoothstep(.68,1.0,1.0-skyUV.y)*.28;
      }else{
        float edge=distanceToCenter-1.0;
        float halo=exp(-edge*150.0)*.65+exp(-edge*38.0)*.085;
        color+=vec3(.04,.32,.85)*halo;
      }
      // Subtle vignette keeps the headline legible and the horizon luminous.
      float vignette=1.0-.25*pow(length((skyUV-.5)*vec2(1.0,.5)),1.4);
      gl_FragColor=vec4(color*vignette,1.0);
    }
  `;

  function canAnimate(){return active&&visible&&!document.hidden&&!paused;}
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;lastFrame=0;video.pause();}
  function updateControl(){
    hero.classList.toggle('motion-paused',paused);
    control.setAttribute('aria-pressed',String(paused));
    control.setAttribute('aria-label',paused?'Resume scene animation':'Pause scene animation');
    control.querySelector('span').textContent=paused?'Resume motion':'Pause motion';
  }
  function useVideo(){
    ready=false;hero.dataset.renderer='video';
    var poster=video.dataset.poster;
    if(poster){video.poster=poster;hero.querySelector('.hero-art').style.backgroundImage='url("'+poster+'")';}
    if(!canAnimate())return;
    var source=video.querySelector('source');
    if(!source.hasAttribute('src')){source.src=source.dataset.src;video.load();}
    var playing=video.play();
    if(playing&&playing.catch)playing.catch(function(){hero.classList.remove('video-playing');});
  }
  function render(){
    if(!ready||!gl||gl.isContextLost())return;
    var bounds=hero.getBoundingClientRect();
    var scale=Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(1900000/Math.max(1,bounds.width*bounds.height)));
    var width=Math.max(1,Math.round(bounds.width*scale)),height=Math.max(1,Math.round(bounds.height*scale));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    pointer.x+=(target.x-pointer.x)*.065;pointer.y+=(target.y-pointer.y)*.065;
    gl.useProgram(program);gl.uniform2f(uniforms.size,width,height);
    gl.uniform2f(uniforms.pointer,pointer.x,pointer.y);gl.uniform1f(uniforms.time,elapsed);
    gl.uniform1f(uniforms.scroll,scroll);gl.drawArrays(gl.TRIANGLES,0,6);
    hero.style.setProperty('--scene-x',pointer.x.toFixed(4));hero.style.setProperty('--scene-y',pointer.y.toFixed(4));
  }
  function tick(now){
    frame=0;if(!canAnimate()||!ready)return;
    if(!lastFrame)lastFrame=now;
    if(now-lastFrame>=1000/30){elapsed+=Math.min((now-lastFrame)/1000,.1);lastFrame=now;render();}
    frame=requestAnimationFrame(tick);
  }
  function reconcile(){
    stop();updateControl();
    if(!active||!visible||document.hidden)return;
    if(ready){render();if(!paused)frame=requestAnimationFrame(tick);}else useVideo();
  }
  function compile(type,source){
    var shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){var reason=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(reason);}
    return shader;
  }
  function release(){
    if(!gl)return;
    if(texture)gl.deleteTexture(texture);if(cloudTexture)gl.deleteTexture(cloudTexture);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);
    texture=cloudTexture=buffer=program=null;
  }
  function init(){
    var attempt=++generation;
    try{
      if(!window.WebGLRenderingContext)throw new Error('WebGL unavailable');
      gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
      if(!gl)throw new Error('WebGL unavailable');
      release();
      var high=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      var fragment=high&&high.precision?fragmentSource:fragmentSource.replace('precision highp float','precision mediump float');
      var vertex=compile(gl.VERTEX_SHADER,vertexSource),pixel=compile(gl.FRAGMENT_SHADER,fragment);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,pixel);gl.linkProgram(program);
      gl.deleteShader(vertex);gl.deleteShader(pixel);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Unable to link the Earth renderer');
      gl.useProgram(program);
      buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      var position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      uniforms={size:gl.getUniformLocation(program,'uSize'),pointer:gl.getUniformLocation(program,'uPointer'),time:gl.getUniformLocation(program,'uTime'),scroll:gl.getUniformLocation(program,'uScroll')};
      gl.uniform1i(gl.getUniformLocation(program,'uEarth'),0);
      gl.uniform1i(gl.getUniformLocation(program,'uClouds'),1);
      cloudTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,cloudTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,0]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      var image=new Image();
      image.onload=function(){
        if(attempt!==generation||gl.isContextLost())return;
        try{
          texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.generateMipmap(gl.TEXTURE_2D);
          ready=true;hero.dataset.renderer='webgl';video.pause();reconcile();
        }catch(e){release();useVideo();}
      };
      image.onerror=function(){if(attempt===generation){release();useVideo();}};
      image.src=canvas.dataset.texture;
      var clouds=new Image();
      clouds.onload=function(){
        if(attempt!==generation||!cloudTexture||gl.isContextLost())return;
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,cloudTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,clouds);
        if(active&&visible)render();
      };
      // The base globe remains usable if the optional cloud layer cannot load.
      clouds.onerror=function(){};
      clouds.src=canvas.dataset.clouds;
    }catch(e){release();useVideo();}
  }
  video.addEventListener('playing',function(){hero.classList.add('video-playing');});
  video.addEventListener('error',function(){hero.classList.remove('video-playing');});
  canvas.addEventListener('webglcontextlost',function(e){e.preventDefault();++generation;stop();useVideo();});
  canvas.addEventListener('webglcontextrestored',function(){init();});
  hero.addEventListener('pointermove',function(e){
    if(e.pointerType==='touch'||!canAnimate())return;
    var rect=hero.getBoundingClientRect();target.x=((e.clientX-rect.left)/rect.width-.5)*2;target.y=((e.clientY-rect.top)/rect.height-.5)*2;
  },{passive:true});
  hero.addEventListener('pointerleave',function(){target.x=target.y=0;});
  window.addEventListener('scroll',function(){var rect=hero.getBoundingClientRect();scroll=Math.min(1,Math.max(0,-rect.top/Math.max(1,rect.height)));},{passive:true});
  window.addEventListener('resize',function(){if(active&&visible)render();},{passive:true});
  document.addEventListener('visibilitychange',reconcile);
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',reconcile);
  if(window.IntersectionObserver){new IntersectionObserver(function(entries){visible=entries[0].isIntersecting;reconcile();},{threshold:0}).observe(hero);}
  control.addEventListener('click',function(){paused=!paused;try{localStorage.setItem('veyra-motion-paused',String(paused));}catch(e){}if(paused){target.x=target.y=pointer.x=pointer.y=0;hero.style.setProperty('--scene-x','0');hero.style.setProperty('--scene-y','0');}reconcile();});
  function changedPreference(){paused=preference.matches;try{paused=paused||localStorage.getItem('veyra-motion-paused')==='true';}catch(e){}target.x=target.y=pointer.x=pointer.y=0;reconcile();}
  if(preference.addEventListener)preference.addEventListener('change',changedPreference);
  window.VeyraScene={pause:function(){active=false;target.x=target.y=0;reconcile();},resume:function(){active=true;reconcile();}};
  updateControl();init();
})();
