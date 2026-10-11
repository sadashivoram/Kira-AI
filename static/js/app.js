import { setupNetworkHandler } from "./networkHandler.js";
import { AvatarWidget } from "./avatarWidget.js";
import { VoiceEngine } from "./voiceEngine.js";

    const $ = (id) => document.getElementById(id);
    const csrfHeaders = () => ({ "Content-Type": "application/json", "X-CSRF-Token": csrfToken });
    let csrfToken = "", currentEmail = "", isSignup = false, busy = false, aiConfigured = false;
    let recognition = null, wakeEnabled = false, awaitingCommand = false, restartTimer = 0;
    let speechPending = false;
    let removeNetworkListeners = () => {};
    let vrm = null, renderer = null, scene = null, camera = null;
    let THREE = null, GLTFLoader = null, VRMLoaderPlugin = null, VRMUtils = null;
    let animationFrame = 0, nextBlink = 0;
    let avatarWidget = null;
    let voiceEngine = null;
    const SETTINGS_KEY = "kira.preferences.v1";
    const settings = Object.assign({ autoSpeak: true, rate: 1, voiceURI: "", recognitionLang: "en-IN", assistantGender: "female" }, safeSettings());
    $("auto-speak").checked = settings.autoSpeak;
    $("auto-setting").checked = settings.autoSpeak;
    $("rate-slider").value = String(settings.rate);
    $("assistant-gender").value = settings.assistantGender;
    function safeSettings(){try{const value=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}");return{autoSpeak:typeof value.autoSpeak==="boolean"?value.autoSpeak:true,rate:Number.isFinite(value.rate)&&value.rate>=.75&&value.rate<=1.25?value.rate:1,voiceURI:typeof value.voiceURI==="string"?value.voiceURI:"",recognitionLang:["en-IN","hi-IN"].includes(value.recognitionLang)?value.recognitionLang:"en-IN",assistantGender:["female","male"].includes(value.assistantGender)?value.assistantGender:"female"}}catch{return {}}}
    function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}

    function setNotice(text, error=false){$("notice").textContent=text;$("notice").style.color=error?"#faad9e":""}
    async function api(path, body, withCsrf=true){
      const headers=withCsrf?csrfHeaders():{"Content-Type":"application/json"};
      const response=await fetch(path,{method:"POST",credentials:"same-origin",headers,body:JSON.stringify(body)});
      const data=await response.json().catch(()=>({error:"The server returned an invalid response."}));
      if(!response.ok)throw new Error(data.error||"The request could not be completed.");
      return data;
    }
    function updateProfile(email){currentEmail=email;$("profile-email").textContent=email||"Not signed in"}
    function updateGreeting(){const hour=new Date().getHours();const text=hour<12?"Good morning":hour<17?"Good afternoon":hour<21?"Good evening":"Good night";$("greeting").innerHTML=`${text}. I'm <em>Kira.</em>`}
    function setAuthenticated(email, token){csrfToken=token||"";updateProfile(email);$("auth-cover").classList.add("auth-hide");setTimeout(()=>$("auth-cover").classList.add("hidden"),350);updateGreeting();loadChatHistory()}
    function setSignedOut(){csrfToken="";currentEmail="";updateProfile("");$("messages").replaceChildren();$("hero").classList.remove("hidden");$("auth-cover").classList.remove("hidden","auth-hide");$("auth-password").value=""}
    async function initialize(){
      voiceEngine=new VoiceEngine({
        getPreferences:()=>settings,
        onMouthUpdate:value=>setMouth(value),
        onSpeakingChange:speaking=>{
          if(speaking)speechPending=false;
          else if(wakeEnabled&&!speechPending)resumeRecognition(350)
        },
        onError:error=>{setNotice(error.message,true);if(wakeEnabled)resumeRecognition(600)}
      });
      populateVoices();window.speechSynthesis?.addEventListener?.("voiceschanged",populateVoices);
      setupNetworkEvents();
      try{const [session,status]=await Promise.all([fetch("/api/session",{credentials:"same-origin"}).then(r=>r.json()),fetch("/api/status").then(r=>r.json())]);if(session.authenticated)setAuthenticated(session.email,session.csrf_token);aiConfigured=status.ai_configured;setupNetworkEvents();}
      catch{$("status-text").textContent="Connection unavailable";$("status-dot").classList.add("offline")}
      setupAvatar();
    }
    $("login-tab").addEventListener("click",()=>setAuthMode(false));$("signup-tab").addEventListener("click",()=>setAuthMode(true));
    function setAuthMode(signup){isSignup=signup;$("login-tab").classList.toggle("selected",!signup);$("signup-tab").classList.toggle("selected",signup);$("auth-title").textContent=signup?"Create your account":"Welcome back";$("auth-submit").textContent=signup?"Create account":"Log in";$("auth-password").autocomplete=signup?"new-password":"current-password";$("auth-password").minLength=signup?12:1;$("auth-error").textContent=signup?"Use at least 12 characters for your password.":""}
    $("auth-form").addEventListener("submit",async(event)=>{event.preventDefault();$("auth-error").textContent="";$("auth-submit").disabled=true;try{const result=await api(isSignup?"/api/signup":"/api/login",{email:$("auth-email").value,password:$("auth-password").value},false);setAuthenticated(result.email,result.csrf_token)}catch(error){$("auth-error").textContent=error.message}finally{$("auth-submit").disabled=false}});
    $("signout").addEventListener("click",async()=>{try{await api("/api/logout",{})}catch(error){setNotice(error.message,true)}finally{stopWake();setSignedOut()}});
    $("settings-open").addEventListener("click",openSettings);$("top-settings").addEventListener("click",openSettings);$("settings-close").addEventListener("click",closeSettings);$("settings-done").addEventListener("click",closeSettings);
    function openSettings(){$("settings-modal").classList.remove("hidden");populateVoices()}
    function closeSettings(){$("settings-modal").classList.add("hidden")}
    $("auto-speak").addEventListener("change",()=>{$("auto-setting").checked=$("auto-speak").checked;settings.autoSpeak=$("auto-speak").checked;saveSettings()});
    $("auto-setting").addEventListener("change",()=>{$("auto-speak").checked=$("auto-setting").checked;settings.autoSpeak=$("auto-setting").checked;saveSettings()});
    $("rate-slider").addEventListener("input",()=>{settings.rate=Number($("rate-slider").value);saveSettings()});
    $("recognition-language").value=settings.recognitionLang;
    $("recognition-language").addEventListener("change",()=>{settings.recognitionLang=$("recognition-language").value;saveSettings()});
    $("assistant-gender").addEventListener("change",()=>{settings.assistantGender=$("assistant-gender").value;saveSettings()});
    $("voice-select").addEventListener("change",()=>{settings.voiceURI=$("voice-select").value;saveSettings()});
    function populateVoices(){
      if(!("speechSynthesis" in window))return;
      const select=$("voice-select"),voices=window.speechSynthesis.getVoices();if(!voices.length)return;
      const old=settings.voiceURI;select.replaceChildren();
      const auto=document.createElement("option");auto.value="";auto.textContent="Automatic";select.append(auto);
      for(const voice of voices){const option=document.createElement("option");option.value=voice.voiceURI;option.textContent=`${voice.name} (${voice.lang})`;select.append(option)}
      select.value=old&&voices.some(v=>v.voiceURI===old)?old:"";
    }
    $("pause-speech").addEventListener("click",()=>voiceEngine?.pause());$("resume-speech").addEventListener("click",()=>voiceEngine?.resume());$("stop-speech").addEventListener("click",stopSpeaking);
    function speak(text,force=false,languageOverride=""){
      if(!voiceEngine){setNotice("Speech output is still loading. Please try again.",true);return}
      speechPending=true;
      clearTimeout(restartTimer);
      if(wakeEnabled&&recognition){try{recognition.stop()}catch{}}
      void voiceEngine.speak(text,{force,language:languageOverride||"hi-IN"}).catch(error=>{
        speechPending=false;
        setNotice(error.message,true);
        if(wakeEnabled)resumeRecognition(600);
      });
    }
    function stopSpeaking(){speechPending=false;voiceEngine?.stop();setMouth(0)}
    function setMouth(value){avatarWidget?.setMouth(value);if(vrm?.expressionManager){for(const name of ["aa","ih","ou","ee","oh"]){try{vrm.expressionManager.setValue(name,value*(name==="aa"?.85:.22))}catch{}}}}

    async function sendMessage(text){
      const clean=text.trim();if(!clean||busy)return;
      const destination=commandUrl(clean);
      $("hero").classList.add("hidden");appendMessage("user",clean);
      if(destination){executeCommand(destination);return}
      busy=true;$("send-button").disabled=true;
      const pending=appendMessage("assistant","Thinking...");
      try{const data=await api("/api/chat",{messages:[{role:"user",content:clean}]});pending.querySelector(".bubble").textContent=data.reply;addPlaybackControls(pending,data.reply);if(settings.autoSpeak)speak(data.reply);if(data.sources?.length)addSources(pending,data.sources)}
      catch(error){pending.querySelector(".bubble").textContent=error.message;setNotice(error.message,true)}
      finally{busy=false;$("send-button").disabled=false;$("message-input").focus()}
    }
    async function loadChatHistory(){
      if(!csrfToken)return;
      try{
        const response=await fetch("/api/history",{credentials:"same-origin"});
        const data=await response.json().catch(()=>({error:"Could not read chat history."}));
        if(!response.ok)throw new Error(data.error||"Could not load chat history.");
        $("messages").replaceChildren();
        for(const message of data.messages||[]){
          const item=appendMessage(message.role,message.content);
          if(message.role==="assistant")addPlaybackControls(item,message.content);
        }
        $("hero").classList.toggle("hidden",(data.messages||[]).length>0);
      }catch(error){setNotice(error.message,true)}
    }
    $("chat-form").addEventListener("submit",event=>{event.preventDefault();const value=$("message-input").value;$("message-input").value="";sendMessage(value)});
    $("messages").addEventListener("click",event=>{const button=event.target.closest("[data-action]");if(!button)return;const item=button.closest(".message"),text=item.dataset.reply||"";if(button.dataset.action==="speak")speak(text,true,item.dataset.speechLang||"");if(button.dataset.action==="stop")stopSpeaking();if(button.dataset.action==="pause")window.speechSynthesis?.pause();if(button.dataset.action==="resume")window.speechSynthesis?.resume()});
    function appendMessage(role,text){const item=document.createElement("article");item.className=`message ${role}`;const icon=document.createElement("div");icon.className="icon";icon.textContent=role==="assistant"?"✳":(currentEmail[0]||"Y").toUpperCase();const body=document.createElement("div");body.className="bubble";body.textContent=text;item.append(icon,body);item.dataset.reply=text;$("messages").append(item);$("messages").scrollIntoView({block:"end",behavior:"smooth"});return item}
    function addPlaybackControls(item,text,language=""){item.dataset.reply=text;if(language)item.dataset.speechLang=language;const controls=document.createElement("div");controls.className="controls";for(const [action,label] of [["speak","Speak"],["stop","Stop Speaking"],["pause","Pause"],["resume","Resume"]]){const button=document.createElement("button");button.type="button";button.dataset.action=action;button.textContent=label;controls.append(button)}item.querySelector(".bubble").append(controls)}
    function setupNetworkEvents(){
      removeNetworkListeners();
      removeNetworkListeners=setupNetworkHandler({
        getUserName:()=>currentEmail.split("@")[0].replace(/[._-]+/g," ").replace(/\b\w/g,letter=>letter.toUpperCase()),
        getVoiceGender:()=>settings.assistantGender,
        onStatusChange:status=>{
          $("status-text").textContent=status==="offline"?"Offline":aiConfigured?"Online":"AI setup needed";
          $("status-dot").classList.toggle("online",status==="online"&&aiConfigured);
          $("status-dot").classList.toggle("offline",status==="offline"||!aiConfigured);
        },
        onDialogue:({text,language})=>{
          if(!currentEmail)return;
          $("hero").classList.add("hidden");
          const message=appendMessage("assistant",text);
          addPlaybackControls(message,text,language);
          speak(text,true,language);
        }
      });
    }
    function addSources(item,sources){const wrap=document.createElement("div");wrap.className="controls";const label=document.createElement("span");label.className="small";label.textContent="Sources:";wrap.append(label);for(const source of sources){try{const url=new URL(source.uri);if(url.protocol!=="https:")continue;const link=document.createElement("a");link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";link.textContent=source.title||url.hostname;link.className="small";wrap.append(link)}catch{}}item.querySelector(".bubble").append(wrap)}

    const sites=[["whatsapp",/^(?:open|go to|खोलो|खोल दीजिए)\s+(?:the\s+)?whats?app$/i,"https://web.whatsapp.com/"],["google",/^(?:open|go to|खोलो|खोल दीजिए)\s+(?:the\s+)?google$/i,"https://www.google.com/"],["youtube",/^(?:open|go to|खोलो|खोल दीजिए)\s+(?:the\s+)?youtube$/i,"https://www.youtube.com/"],["gmail",/^(?:open|go to|खोलो|खोल दीजिए)\s+(?:the\s+)?gmail$/i,"https://mail.google.com/"],["instagram",/^(?:open|go to|खोलो|खोल दीजिए)\s+(?:the\s+)?instagram$/i,"https://www.instagram.com/"]];
    function commandUrl(text){return sites.find(([,regex])=>regex.test(text.trim()))?.[2]||""}
    function executeCommand(url){window.open(url,"_blank","noopener,noreferrer");const host=new URL(url).hostname;const reply=`Requested ${host} to open in a new tab. If you don't see it, check your browser's pop-up settings.`;appendMessage("assistant",reply);const last=$("messages").lastElementChild;addPlaybackControls(last,reply);if(settings.autoSpeak)speak(reply)}
    function addUserText(text){sendMessage(text)}

    async function ensureMicrophone(){
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone access is not available. Use a supported browser over HTTPS or localhost.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop())
    }
    function recognitionConstructor(){return window.SpeechRecognition||window.webkitSpeechRecognition}
    $("listen-button").addEventListener("click",async()=>{try{await ensureMicrophone();startRecognition(false)}catch(error){setNotice(error.message,true)}});
    $("wake-button").addEventListener("click",async()=>{if(wakeEnabled){stopWake();return}try{await ensureMicrophone();wakeEnabled=true;$("wake-button").classList.add("active");$("wake-button").textContent="◉ Stop Hey Kira";$("mic-status").textContent="Wake listening active";setNotice("Hey Kira is listening. Say “Hey Kira” to wake the assistant.");startRecognition(true)}catch(error){wakeEnabled=false;setNotice(error.message,true)}});
    function startRecognition(wake){
      const Constructor=recognitionConstructor();if(!Constructor){setNotice("Speech recognition is not supported in this browser.",true);if(wake)stopWake();return}
      if(recognition){try{recognition.stop()}catch{}}
      recognition=new Constructor();recognition.lang=settings.recognitionLang;recognition.continuous=wake;recognition.interimResults=false;recognition.maxAlternatives=1;
      recognition.onresult=(event)=>{const result=event.results[event.results.length-1];if(!result?.isFinal)return;const transcript=result[0].transcript.trim();if(!transcript)return;
        if(wakeEnabled&&!awaitingCommand){if(/(?:hey\s*)?kira|हे\s*कि[रड़]ा|कि[रड़]ा/i.test(transcript)){awaitingCommand=true;if(avatarWidget&&avatarWidget.widget)avatarWidget.widget.classList.add("wake-pulse");setTimeout(()=>{if(avatarWidget&&avatarWidget.widget)avatarWidget.widget.classList.remove("wake-pulse")},1500);const greeting=/[\u0900-\u097f]/.test(transcript)?"हाँ, मैं सुन रही हूँ—बताइए?":"Yes, I'm listening. What can I help you with?";appendMessage("assistant",greeting);addPlaybackControls($("messages").lastElementChild,greeting);speak(greeting,true)}return}
        if(wakeEnabled&&awaitingCommand){awaitingCommand=false;addUserText(transcript);return}
        addUserText(transcript)
      };
      recognition.onerror=(event)=>{if(["not-allowed","service-not-allowed"].includes(event.error)){setNotice("Microphone permission was denied. Check your browser site settings.",true);if(wakeEnabled)stopWake()}else if(event.error!=="no-speech"&&event.error!=="aborted")setNotice("Voice recognition stopped. Tap Start Listening to try again.",true)};
      recognition.onend=()=>{if(wakeEnabled&&recognition){resumeRecognition(700)}else{$("listen-button").textContent="♩ Start Listening";$("mic-status").textContent="Not active"}};
      try{recognition.start();$("mic-status").textContent=wake?"Wake listening active":"Listening";$("listen-button").textContent="◉ Listening...";setNotice(wake?"Wake word listening is active.":"Listening in English (India).")}
      catch(error){setNotice("Could not start speech recognition. Try again.",true);if(wake)stopWake()}
    }
    function resumeRecognition(delay=400){clearTimeout(restartTimer);if(!wakeEnabled||document.hidden)return;restartTimer=setTimeout(()=>{if(wakeEnabled&&recognition&&!window.speechSynthesis?.speaking){try{recognition.start()}catch{}}},delay)}
    function stopWake(){wakeEnabled=false;awaitingCommand=false;clearTimeout(restartTimer);if(recognition){recognition.onend=null;try{recognition.stop()}catch{}recognition=null}$("wake-button").classList.remove("active");$("wake-button").textContent="◉ Enable Hey Kira";$("mic-status").textContent="Not active";$("listen-button").textContent="♩ Start Listening";setNotice("Hey Kira listening is off.")}
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&wakeEnabled)resumeRecognition(500)});

    async function setupAvatar(){
      const canvas=$("avatar-canvas");
      try{
        [THREE,{GLTFLoader},{VRMLoaderPlugin,VRMUtils}]=await Promise.all([import("three"),import("three/addons/loaders/GLTFLoader.js"),import("@pixiv/three-vrm")]);
        renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
        renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
        renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
        renderer.outputColorSpace=THREE.SRGBColorSpace;
        scene=new THREE.Scene();
        camera=new THREE.PerspectiveCamera(30,canvas.clientWidth/canvas.clientHeight||1,.1,100);
        camera.position.set(0,1.35,3.6);
        scene.add(new THREE.HemisphereLight(0xe6ddff,0x30304a,2));
        const key=new THREE.DirectionalLight(0xffeddf,2.3);
        key.position.set(1,3,4);
        scene.add(key);
        const fill=new THREE.DirectionalLight(0x9b82ff,1.5);
        fill.position.set(-3,1,1);
        scene.add(fill);
        
        // Initialize avatar widget with canvas
        avatarWidget=new AvatarWidget({
          canvas:canvas,
          onClose:()=>{
            // Optional: handle widget close event
            canvas.style.display="none";
          }
        });
        
        const resize=new ResizeObserver(()=>{
          if(!renderer)return;
          const w=canvas.clientWidth,h=canvas.clientHeight;
          renderer.setSize(w,h,false);
          camera.aspect=w/Math.max(h,1);
          camera.updateProjectionMatrix()
        });
        resize.observe(canvas);
        
        let start=performance.now();
        nextBlink=start+3500;
        const frame=(now)=>{
          animationFrame=requestAnimationFrame(frame);
          if(vrm){
            const t=(now-start)/1000;
            vrm.scene.rotation.y=Math.sin(t*.42)*.055;
            vrm.scene.rotation.x=Math.sin(t*.7)*.012;
            if(now>nextBlink){
              try{vrm.expressionManager?.setValue("blink",1);setTimeout(()=>vrm?.expressionManager?.setValue("blink",0),130)}catch{}
              nextBlink=now+3000+Math.random()*3000
            }
            vrm.update(Math.min(.05,1/60))
          }
          renderer.render(scene,camera)
        };
        animationFrame=requestAnimationFrame(frame)
      }catch{
        if(avatarWidget)avatarWidget.updateHint("WebGL is unavailable. Chat and voice features can still be used.")
      }
    }
    $("avatar-file").addEventListener("change",async(event)=>{
      const file=event.target.files?.[0];
      if(!file)return;
      if(!/\.vrm$/i.test(file.name)){ 
        $("settings-error").textContent="Choose a VRM model file.";
        return
      }
      if(!GLTFLoader){
        $("settings-error").textContent="The 3D avatar runtime is unavailable. Check your internet connection.";
        return
      }
      $("settings-error").textContent="Loading avatar...";
      const objectUrl=URL.createObjectURL(file);
      try{
        const loader=new GLTFLoader();
        loader.register(parser=>new VRMLoaderPlugin(parser));
        const gltf=await loader.loadAsync(objectUrl);
        const next=gltf.userData.vrm;
        if(!next)throw new Error("This file does not contain a VRM avatar.");
        if(vrm){scene.remove(vrm.scene);VRMUtils.deepDispose(vrm.scene)}
        vrm=next;
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);
        vrm.scene.position.set(0,0,0);
        const message=`${file.name} loaded locally`;
        if(avatarWidget)avatarWidget.updateHint(message);
        $("settings-error").textContent=""
      }catch(error){
        $("settings-error").textContent=error.message||"Could not load this VRM model."
      }finally{
        URL.revokeObjectURL(objectUrl)
      }
    });
    window.addEventListener("beforeunload",()=>{
      cancelAnimationFrame(animationFrame);
      removeNetworkListeners();
      window.speechSynthesis?.cancel();
      if(renderer)renderer.dispose();
      if(wakeEnabled)stopWake();
      if(avatarWidget&&avatarWidget.widget)avatarWidget.widget.remove()
    });
    initialize();
