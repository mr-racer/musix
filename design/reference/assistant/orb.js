/* The assistant's orb on WebGL. Two real materials, no rendered gloss (preferences.md,
   2026-10-06: a specular hotspot or plastic sheen reads as artificial):
   - «Хрусталь» (uMat 0): a clear glass ball. Like a real crystal ball it is a lens: what is
     behind it (the room's light, the questions on their orbit) shows inside upside down and
     magnified, with a little dispersion at the rim and the dark band of total internal
     reflection. Coloured smoke drifts inside like ink in water; its colour is the kind of
     request understood. Light enters from above and gathers in a crescent at the bottom.
   - «Лампа» (uMat 1): frosted glass with a light inside. What is behind it is only a soft
     blur; a core of light wanders, leans to the field while typing, brightens with work.
   The page paints the room behind the ball into `bg` (a 2D canvas) every frame and the
   shader samples it, so the refraction is of the real page, not of a picture. */
const Orb = (() => {
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform float uR;uniform vec3 uC1;uniform vec3 uC2;
uniform float uE;uniform float uMat;uniform vec2 uLean;uniform float uRip;uniform float uPulse;
uniform float uDim;uniform sampler2D uBg;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return mod289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float sn(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=mod289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){return .55*sn(p)+.28*sn(p*2.03+7.1)+.17*sn(p*4.11+3.3);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 bg(vec2 v){return texture2D(uBg,clamp(.5+v*uR/uRes,0.,1.)).rgb;}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 q=(gl_FragCoord.xy-.5*uRes)/uR;float r2=dot(q,q);float r=sqrt(r2);
  float spd=.035+.035*uE;
  if(r<1.){
    float z=sqrt(1.-r2);vec3 n=vec3(q,z);float fres=pow(1.-z,2.6);
    float ring=uRip<3.?exp(-pow((r-uRip*.95)*12.,2.))*exp(-uRip*1.4):0.;
    vec3 col;
    if(uMat<.5){
      float k=.58+.62*r2;vec2 b=-q*k*(1.+ring*.06);
      vec3 refr=vec3(bg(b*(1.+.03*r2)).r,bg(b).g,bg(b*(1.-.03*r2)).b);
      vec3 smoke=vec3(0.);float a=0.;
      for(int i=0;i<5;i++){
        float d=mix(.75,-.75,float(i)/4.);if(abs(d)>z)continue;
        vec3 pos=vec3(q,d);pos.xz=rot(uT*spd*(1.+.25*float(i)))*pos.xz;
        pos.y+=uT*.022*(1.+.5*uE);
        float w=fbm(pos*1.25+.6*sn(pos*.9+uT*.04));
        float tend=pow(1.-abs(sn(pos*1.3+vec3(0.,uT*.03,0.))),8.);
        float dens=(smoothstep(.12,.85,w)*.7+tend*.3)*smoothstep(z,z*.35,abs(d));
        dens*=(.1+1.05*uE)*(1.-.35*r2);
        vec3 c=mix(uC2,uC1,smoothstep(-.4,.6,sn(pos*.7+11.)));
        smoke+=c*dens*.42*(1.-a);a+=dens*.3*(1.-a);
      }
      col=refr*(.95-.45*fres)*(1.-a*.55)+smoke*(1.+uPulse*.8);
      col+=mix(vec3(.06,.07,.1),vec3(.62,.66,.78),smoothstep(-.1,.95,n.y))*fres*.55;
      col+=mix(uC1,vec3(1.),.35)*smoothstep(.78,.97,r)*smoothstep(-.15,-.85,n.y)*(.18+.45*uE);
      col+=uC1*ring*.5;
      col*=1.-.55*smoothstep(.9,.99,r)*(1.-smoothstep(.993,1.,r));
      col+=vec3(.9,.92,1.)*smoothstep(.975,.998,r)*(1.-smoothstep(.998,1.,r))*.35;
    }else{
      vec3 fro=vec3(0.);for(int i=0;i<8;i++){float an=float(i)*.785+.3;fro+=bg(q*.8+vec2(cos(an),sin(an))*.22);}fro/=8.;
      vec2 c=uLean*.3+.2*vec2(sin(uT*.31),cos(uT*.25))*(1.+.25*uE);
      float l=exp(-dot(q-c,q-c)*(3.2-1.6*uE));
      float wisp=fbm(vec3(q*1.8,uT*.09*(1.+.5*uE)));
      vec3 light=mix(uC2,uC1,l)*l*(.75+.9*uE)*(1.+.35*wisp);
      vec3 glow=mix(uC1,uC2,.5)*(.14+.22*uE)*(.55+.45*z);
      col=fro*.42*(1.-.3*l)+light+glow;
      col*=mix(.6,1.,z);col*=1.+uPulse*.6;
      col+=uC1*ring*.6;
      col+=(hash(floor(gl_FragCoord.xy))-.5)*.035;
      col+=vec3(.7,.74,.85)*smoothstep(-.2,.95,n.y)*fres*.22;
      col+=vec3(.9,.92,1.)*smoothstep(.98,.999,r)*(1.-smoothstep(.999,1.,r))*.18;
    }
    col*=1.-uDim*.55;
    float aa=1.-smoothstep(1.-1.6/uR,1.,r);
    gl_FragColor=vec4(col*aa,aa);
  }else{
    float h=exp(-(r-1.)*(uMat<.5?6.:4.5))*(.06+.28*uE)*(1.-uDim*.7)*smoothstep(1.56,1.2,r);
    vec3 c=mix(uC1,uC2,.4)*h;gl_FragColor=vec4(c,max(c.r,max(c.g,c.b))*.9);
  }
}`;

  function make(canvas, bgCanvas) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return null;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const n of ["uRes", "uT", "uR", "uC1", "uC2", "uE", "uMat", "uLean", "uRip", "uPulse", "uDim", "uBg"]) U[n] = gl.getUniformLocation(pr, n);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return (s) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
      gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uT, s.t); gl.uniform1f(U.uR, s.r);
      gl.uniform3fv(U.uC1, s.c1); gl.uniform3fv(U.uC2, s.c2); gl.uniform1f(U.uE, s.e); gl.uniform1f(U.uMat, s.mat);
      gl.uniform2f(U.uLean, s.lean[0], s.lean[1]); gl.uniform1f(U.uRip, s.rip); gl.uniform1f(U.uPulse, s.pulse); gl.uniform1f(U.uDim, s.dim);
      gl.uniform1i(U.uBg, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }
  return { make };
})();
