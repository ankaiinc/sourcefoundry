const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function landingPage(baseUrl: string): string {
  const origin = escapeHtml(baseUrl);
  const agentPrompt = `Open ${baseUrl}/agent.md. Set up Feedline, store SOURCEFOUNDRY_API_TOKEN in your secret store, then build a recurring source feed from the sources I describe. Run it and return new source items with links, dates, original sources, completeness, and source health. Do not rank, summarize, or publish unless I ask.`;
  const escapedPrompt = escapeHtml(agentPrompt);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Feedline continuously collects, cleans, and monitors sources for news feeds, trackers, briefs, and research agents." />
  <meta name="theme-color" content="#F6F8FB" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Spline+Sans:wght@400..700&amp;family=Spline+Sans+Mono:wght@400..700&amp;display=swap" rel="stylesheet" />
  <link rel="alternate" type="text/markdown" href="${origin}/agent.md" title="Feedline agent guide" />
  <link rel="alternate" type="text/plain" href="${origin}/llms.txt" title="Feedline LLM instructions" />
  <title>Feedline — source supply for agents</title>
  <style>
    :root {
      --canvas:#f6f8fb;
      --surface:#ffffff;
      --ink:#0b1220;
      --muted:#566276;
      --blue:#1457ff;
      --blue-dark:#0a3dc2;
      --steel:#d7dee8;
      --steel-soft:#e9edf3;
      --pass:#087a4d;
      --reject:#c9362b;
      --warning:#9a5b00;
      --sensor:#c7f23a;
      --max:1344px;
    }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; background:var(--canvas); }
    body { margin:0; color:var(--ink); background:var(--canvas); font-family:"Spline Sans",Avenir Next,Avenir,sans-serif; font-size:17px; line-height:1.6; text-rendering:optimizeLegibility; }
    button,input { font:inherit; }
    a { color:inherit; text-underline-offset:4px; text-decoration-thickness:1px; }
    a:hover { color:var(--blue-dark); }
    :focus-visible { outline:2px solid var(--blue); outline-offset:3px; }
    .shell { width:min(var(--max),calc(100% - 64px)); margin:0 auto; }
    .mono { font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; }
    .section-title { max-width:900px; margin:0; font-size:clamp(42px,5.4vw,76px); font-weight:650; letter-spacing:-.055em; line-height:1.02; }
    .section-copy { max-width:680px; margin:26px 0 0; color:var(--muted); font-size:clamp(18px,1.5vw,22px); line-height:1.58; }
    .button { min-height:48px; display:inline-flex; align-items:center; justify-content:center; gap:10px; padding:12px 18px; border:1px solid var(--blue); border-radius:6px; background:var(--blue); color:#fff; font-size:15px; font-weight:650; text-decoration:none; cursor:pointer; transition:background .18s ease,transform .18s ease,border-color .18s ease; }
    .button:hover { color:#fff; background:var(--blue-dark); border-color:var(--blue-dark); transform:translateY(-1px); }
    .button.secondary { color:var(--ink); background:transparent; border-color:var(--steel); }
    .button.secondary:hover { color:var(--blue-dark); background:var(--surface); border-color:var(--blue); }
    .button.light { color:var(--ink); background:#fff; border-color:#fff; }
    .button.light:hover { color:var(--ink); background:var(--sensor); border-color:var(--sensor); }

    .site-nav { position:relative; z-index:20; border-bottom:1px solid var(--steel); background:rgba(246,248,251,.92); backdrop-filter:blur(14px); }
    .nav-inner { min-height:76px; display:flex; align-items:center; justify-content:space-between; gap:28px; }
    .brand { display:flex; align-items:center; gap:13px; color:var(--ink); text-decoration:none; }
    .brand:hover { color:var(--ink); }
    .brand-mark { width:50px; height:30px; overflow:visible; }
    .brand-name { font-size:22px; font-weight:700; letter-spacing:-.045em; }
    .brand-status { margin-left:2px; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; letter-spacing:.06em; text-transform:uppercase; }
    .nav-links { display:flex; align-items:center; gap:26px; font-size:14px; font-weight:550; }
    .nav-links a { text-decoration:none; }
    .nav-cta { padding:9px 13px; border-radius:5px; background:var(--ink); color:#fff!important; }

    .hero { position:relative; overflow:hidden; padding:100px 0 58px; background:var(--surface); }
    .hero:after { content:""; position:absolute; right:-130px; top:50px; width:420px; height:420px; border:1px solid var(--steel-soft); border-radius:50%; box-shadow:0 0 0 90px rgba(233,237,243,.38),0 0 0 180px rgba(233,237,243,.2); pointer-events:none; }
    .hero-grid { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr); gap:74px; align-items:end; }
    h1 { max-width:970px; margin:0; font-size:clamp(62px,8.3vw,118px); font-weight:670; letter-spacing:-.072em; line-height:.94; }
    .hero-side { padding-bottom:8px; }
    .hero-side p { margin:0; color:var(--muted); font-size:clamp(19px,1.5vw,23px); line-height:1.55; }
    .hero-side p strong { display:block; margin-bottom:12px; color:var(--ink); font-size:clamp(28px,2.6vw,40px); font-weight:630; letter-spacing:-.04em; line-height:1.1; }
    .hero-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:30px; }
    .hero-note { display:flex; align-items:center; gap:10px; margin-top:22px; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; letter-spacing:.03em; }
    .hero-note .pulse { width:8px; height:8px; border-radius:50%; background:var(--pass); box-shadow:0 0 0 5px rgba(8,122,77,.1); }

    .line-window { position:relative; z-index:2; overflow-x:auto; margin-top:72px; padding-bottom:8px; scrollbar-width:thin; }
    .line-scene { min-width:1120px; min-height:328px; position:relative; overflow:hidden; border:1px solid var(--steel); border-radius:12px; background-color:var(--canvas); background-image:linear-gradient(var(--steel-soft) 1px,transparent 1px),linear-gradient(90deg,var(--steel-soft) 1px,transparent 1px); background-size:40px 40px; }
    .scene-label { position:absolute; top:20px; left:24px; z-index:3; margin:0; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
    .line-scene svg { width:100%; height:328px; display:block; }
    .mobile-line { display:none; }
    .traveller { animation:travel 8s linear infinite; }
    .traveller.two { animation-delay:-3.3s; }
    .traveller.three { animation-delay:-6.1s; }
    .scan { animation:scan 2.7s ease-in-out infinite; transform-origin:center; }
    .reject-unit { animation:reject 8s linear infinite; animation-delay:-4.9s; opacity:0; }
    @keyframes travel { 0% { transform:translateX(0); opacity:0; } 7% { opacity:1; } 74% { opacity:1; } 86%,100% { transform:translateX(740px); opacity:0; } }
    @keyframes scan { 0%,18% { transform:translateX(0); opacity:.2; } 48% { opacity:1; } 82%,100% { transform:translateX(42px); opacity:.2; } }
    @keyframes reject { 0%,53% { transform:translate(0,0); opacity:0; } 57% { opacity:1; } 78%,100% { transform:translate(100px,100px); opacity:0; } }

    .truth-strip { border-top:1px solid var(--steel); border-bottom:1px solid var(--steel); background:var(--surface); }
    .truth-inner { display:grid; grid-template-columns:1fr 1fr 1fr; }
    .truth { min-height:150px; padding:27px 34px 30px 0; }
    .truth + .truth { padding-left:34px; border-left:1px solid var(--steel); }
    .truth span { color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
    .truth strong { display:block; margin-top:18px; font-size:23px; font-weight:620; letter-spacing:-.025em; line-height:1.25; }

    .mechanism { padding:130px 0; background:var(--ink); color:#fff; }
    .mechanism .section-copy { color:#aeb8c9; }
    .stages { position:relative; display:grid; grid-template-columns:repeat(4,1fr); margin-top:92px; }
    .stages:before { content:""; position:absolute; top:23px; left:4%; right:4%; height:2px; background:#32405a; }
    .stage { position:relative; padding-right:28px; }
    .stage-index { position:relative; z-index:1; width:48px; height:48px; display:grid; place-items:center; border:2px solid #52627d; border-radius:50%; background:var(--ink); color:#aeb8c9; font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:12px; }
    .stage h3 { margin:28px 0 10px; font-size:22px; font-weight:620; letter-spacing:-.025em; }
    .stage p { margin:0; color:#aeb8c9; font-size:15px; line-height:1.55; }
    .boundary { display:flex; justify-content:space-between; gap:40px; margin-top:78px; padding-top:28px; border-top:1px solid #32405a; color:#aeb8c9; }
    .boundary strong { max-width:600px; color:#fff; font-size:20px; font-weight:550; }
    .boundary span { max-width:460px; text-align:right; }

    .outputs { padding:140px 0 125px; background:var(--surface); }
    .output-layout { display:grid; grid-template-columns:330px 1fr; gap:100px; margin-top:82px; align-items:start; }
    .output-tabs { display:flex; flex-direction:column; border-top:1px solid var(--steel); }
    .output-tab { min-height:64px; display:flex; justify-content:space-between; align-items:center; gap:20px; padding:14px 4px; border:0; border-bottom:1px solid var(--steel); background:transparent; color:var(--muted); text-align:left; cursor:pointer; }
    .output-tab span:last-child { font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; }
    .output-tab:hover,.output-tab.active { color:var(--ink); }
    .output-tab.active { font-weight:650; }
    .output-tab.active span:last-child { color:var(--blue); }
    .output-display { position:relative; min-height:470px; padding:48px 52px; overflow:hidden; border:1px solid var(--steel); border-radius:10px; background:var(--canvas); }
    .output-kicker { color:var(--blue-dark); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; }
    .output-display h3 { max-width:620px; margin:24px 0 36px; font-size:clamp(36px,4vw,62px); font-weight:640; letter-spacing:-.05em; line-height:1.03; }
    .output-rail { position:relative; height:3px; margin:0 -52px 54px; background:var(--blue); }
    .output-rail:after { content:""; position:absolute; right:52px; top:-7px; width:18px; height:18px; background:var(--blue); clip-path:polygon(0 0,100% 50%,0 100%); }
    .output-details { display:grid; grid-template-columns:1fr 1fr; gap:30px; }
    .output-detail { padding-top:15px; border-top:1px solid var(--steel); }
    .output-detail span { display:block; margin-bottom:9px; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
    .output-detail strong { font-size:17px; font-weight:570; }
    .candidate-label { position:absolute; right:52px; bottom:34px; padding:7px 10px; border-radius:4px; background:var(--surface); color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; box-shadow:0 0 0 1px var(--steel); }

    .comparison { padding:126px 0; }
    .compare-visual { display:grid; grid-template-columns:1fr 90px 1fr; margin-top:82px; align-items:stretch; }
    .compare-side { min-height:410px; padding:42px; border:1px solid var(--steel); background:var(--surface); }
    .compare-side h3 { margin:0 0 10px; font-size:28px; font-weight:620; letter-spacing:-.035em; }
    .compare-side > p { margin:0; color:var(--muted); }
    .versus { display:grid; place-items:center; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; text-transform:uppercase; }
    .pile { position:relative; height:190px; margin-top:48px; }
    .result-slip { position:absolute; width:68%; padding:17px 19px; border:1px solid var(--steel); border-radius:5px; background:var(--canvas); color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; }
    .result-slip:nth-child(1) { left:4%; top:15px; transform:rotate(-2deg); }
    .result-slip:nth-child(2) { left:18%; top:70px; transform:rotate(1.5deg); }
    .result-slip:nth-child(3) { left:8%; top:125px; transform:rotate(-.5deg); }
    .supply-mini { position:relative; height:190px; margin-top:48px; }
    .supply-mini:before { content:""; position:absolute; left:3%; right:2%; top:82px; height:3px; background:var(--blue); }
    .mini-gate { position:absolute; left:42%; top:48px; width:54px; height:73px; border:2px solid var(--ink); border-radius:5px; background:var(--surface); }
    .mini-gate:after { content:""; position:absolute; top:9px; bottom:9px; left:14px; width:4px; background:var(--sensor); }
    .mini-candidate { position:absolute; top:69px; width:34px; height:28px; border:2px solid var(--blue); border-radius:4px; background:#fff; }
    .mini-candidate.a { left:8%; }.mini-candidate.b { left:72%; }.mini-candidate.c { left:86%; }
    .mini-reject { position:absolute; left:52%; top:84px; width:92px; height:3px; background:var(--reject); transform:rotate(38deg); transform-origin:left; }
    .mini-reject:after { content:"duplicate"; position:absolute; right:-42px; top:9px; color:var(--reject); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:9px; transform:rotate(-38deg); }
    .compare-outcome { margin-top:22px; padding-top:20px; border-top:1px solid var(--steel); font-weight:600; }

    .agent-handoff { padding:126px 0; background:var(--blue); color:#fff; }
    .agent-grid { display:grid; grid-template-columns:.9fr 1.1fr; gap:90px; align-items:start; }
    .agent-handoff h2 { max-width:610px; margin:0; font-size:clamp(48px,6vw,84px); font-weight:650; letter-spacing:-.06em; line-height:.99; }
    .agent-handoff .lead { max-width:590px; margin:28px 0 0; color:#dce6ff; font-size:20px; }
    .agent-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:32px; }
    .agent-proof { margin-top:26px; color:#dce6ff; font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; }
    .prompt-panel { overflow:hidden; border:1px solid rgba(255,255,255,.28); border-radius:10px; background:var(--ink); box-shadow:0 28px 80px rgba(0,22,85,.28); }
    .panel-top { min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:0 18px; border-bottom:1px solid #32405a; color:#aeb8c9; font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; letter-spacing:.05em; text-transform:uppercase; }
    .panel-status { display:flex; align-items:center; gap:8px; }
    .panel-status:before { content:""; width:7px; height:7px; border-radius:50%; background:var(--sensor); }
    .prompt-text { margin:0; padding:28px; white-space:pre-wrap; color:#edf3ff; font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:13px; line-height:1.75; }
    .panel-footer { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px 18px; border-top:1px solid #32405a; }
    .panel-footer span { color:#aeb8c9; font-size:11px; }
    .copy-button { min-height:40px; padding:8px 12px; border:1px solid #52627d; border-radius:5px; background:#172238; color:#fff; font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; cursor:pointer; }
    .copy-button:hover { border-color:var(--sensor); color:var(--sensor); }

    .operating { padding:126px 0; background:var(--surface); }
    .operating-list { margin-top:74px; border-top:1px solid var(--steel); }
    .operating-row { display:grid; grid-template-columns:150px 1fr 1fr auto; gap:34px; align-items:center; padding:32px 0; border-bottom:1px solid var(--steel); }
    .operating-index { color:var(--blue); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:11px; letter-spacing:.05em; }
    .operating-row h3 { margin:0; font-size:26px; font-weight:620; letter-spacing:-.035em; }
    .operating-row p { margin:0; color:var(--muted); font-size:15px; }
    .operating-row code { padding:7px 9px; border-radius:4px; background:var(--canvas); color:var(--ink); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:10px; white-space:nowrap; }

    .final-line { position:relative; overflow:hidden; padding:118px 0 134px; background:var(--canvas); text-align:center; }
    .final-line:before { content:""; position:absolute; left:0; right:0; top:50%; height:3px; background:var(--blue); }
    .final-content { position:relative; z-index:1; width:min(850px,calc(100% - 40px)); margin:0 auto; padding:55px 70px; border:1px solid var(--steel); border-radius:10px; background:var(--surface); }
    .final-content h2 { margin:0; font-size:clamp(42px,5vw,72px); font-weight:650; letter-spacing:-.055em; line-height:1.02; }
    .final-content p { max-width:620px; margin:22px auto 30px; color:var(--muted); }

    footer { border-top:1px solid var(--steel); background:var(--surface); }
    .footer-inner { min-height:118px; display:flex; align-items:center; justify-content:space-between; gap:32px; color:var(--muted); font-size:13px; }
    .footer-links { display:flex; flex-wrap:wrap; gap:22px; }
    .footer-note { max-width:580px; }

    @media (prefers-reduced-motion:reduce) {
      html { scroll-behavior:auto; }
      *,*:before,*:after { animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; }
    }
    @media (max-width:980px) {
      .shell { width:min(100% - 40px,var(--max)); }
      .brand-status,.nav-links a:not(.nav-cta) { display:none; }
      .hero { padding-top:74px; }
      .hero-grid,.agent-grid { grid-template-columns:1fr; gap:42px; }
      .hero-side { max-width:680px; }
      .truth-inner { grid-template-columns:1fr; }
      .truth { padding:26px 0; }
      .truth + .truth { padding-left:0; border-left:0; border-top:1px solid var(--steel); }
      .stages { grid-template-columns:1fr; gap:0; }
      .stages:before { top:0; bottom:0; left:23px; right:auto; width:2px; height:auto; }
      .stage { min-height:144px; padding:0 0 30px 78px; }
      .stage-index { position:absolute; left:0; top:0; }
      .stage h3 { margin-top:0; }
      .boundary { flex-direction:column; }
      .boundary span { text-align:left; }
      .output-layout { grid-template-columns:1fr; gap:44px; }
      .output-tabs { display:grid; grid-template-columns:1fr 1fr; }
      .output-tab { padding-right:14px; }
      .compare-visual { grid-template-columns:1fr; gap:18px; }
      .versus { min-height:34px; }
      .operating-row { grid-template-columns:80px 1fr; }
      .operating-row p,.operating-row code { grid-column:2; }
      .footer-inner { padding:30px 0; align-items:flex-start; flex-direction:column; }
    }
    @media (max-width:620px) {
      body { font-size:16px; }
      .shell { width:min(100% - 28px,var(--max)); }
      .nav-inner { min-height:66px; }
      .brand-mark { width:44px; }
      .nav-cta { padding:8px 10px; font-size:12px; }
      .hero { padding-top:58px; }
      h1 { font-size:clamp(53px,17vw,76px); line-height:.96; }
      .line-window { margin-top:52px; }
      .line-window { overflow:visible; }
      .line-scene { display:none; }
      .mobile-line { min-height:590px; position:relative; display:block; overflow:hidden; border:1px solid var(--steel); border-radius:10px; background-color:var(--canvas); background-image:linear-gradient(var(--steel-soft) 1px,transparent 1px),linear-gradient(90deg,var(--steel-soft) 1px,transparent 1px); background-size:32px 32px; }
      .mobile-line:before { content:""; position:absolute; top:96px; bottom:62px; left:50%; width:3px; background:var(--blue); transform:translateX(-50%); }
      .mobile-line-label { position:absolute; top:18px; left:18px; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:9px; letter-spacing:.06em; text-transform:uppercase; }
      .mobile-sources { position:absolute; top:66px; left:50%; display:flex; gap:7px; transform:translateX(-50%); }
      .mobile-source { padding:6px 8px; border:1px solid var(--muted); border-radius:14px; background:#fff; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:8px; white-space:nowrap; }
      .mobile-gate { position:absolute; top:204px; left:50%; width:86px; height:126px; border:2px solid var(--ink); border-radius:6px; background:#fff; transform:translateX(-50%); }
      .mobile-gate:before { content:""; position:absolute; top:14px; bottom:14px; left:18px; width:5px; border-radius:3px; background:var(--sensor); }
      .mobile-gate:after { content:"CLEANUP"; position:absolute; top:-30px; left:50%; font-size:11px; font-weight:650; transform:translateX(-50%); }
      .mobile-reject { position:absolute; top:332px; left:50%; width:100px; height:3px; background:var(--reject); transform:rotate(42deg); transform-origin:left; }
      .mobile-reject:after { content:"DUPLICATE"; position:absolute; right:-40px; top:14px; color:var(--reject); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:8px; transform:rotate(-42deg); }
      .mobile-candidate { position:absolute; left:50%; bottom:92px; width:136px; height:64px; border:2px solid var(--blue); border-radius:6px; background:#fff; transform:translateX(-50%); }
      .mobile-candidate:before { content:""; position:absolute; left:14px; top:14px; width:68px; height:7px; border-radius:4px; background:var(--blue); box-shadow:0 16px 0 -1px var(--steel); }
      .mobile-candidate:after { content:"SOURCE · 09:47"; position:absolute; left:14px; bottom:8px; color:var(--muted); font-family:"Spline Sans Mono",SFMono-Regular,Consolas,monospace; font-size:8px; }
      .mobile-output { position:absolute; bottom:30px; left:50%; width:100%; text-align:center; font-size:12px; font-weight:650; transform:translateX(-50%); }
      .mechanism,.outputs,.comparison,.agent-handoff,.operating { padding:92px 0; }
      .section-title { font-size:clamp(40px,12vw,58px); }
      .output-tabs { grid-template-columns:1fr; }
      .output-display { min-height:520px; padding:32px 24px; }
      .output-display h3 { margin-bottom:30px; }
      .output-rail { margin:0 -24px 42px; }
      .output-rail:after { right:24px; }
      .output-details { grid-template-columns:1fr; }
      .candidate-label { right:24px; bottom:24px; }
      .compare-side { min-height:380px; padding:28px 24px; }
      .agent-handoff h2 { font-size:clamp(48px,14vw,68px); }
      .prompt-text { padding:22px 18px; font-size:11px; }
      .panel-footer { align-items:flex-start; flex-direction:column; }
      .operating-row { grid-template-columns:1fr; gap:12px; }
      .operating-row p,.operating-row code { grid-column:1; }
      .operating-row code { white-space:normal; overflow-wrap:anywhere; }
      .final-content { padding:42px 24px; }
    }
  </style>
</head>
<body>
  <nav class="site-nav" aria-label="Primary navigation">
    <div class="shell nav-inner">
      <a class="brand" href="/" aria-label="Feedline home">
        <svg class="brand-mark" viewBox="0 0 56 32" aria-hidden="true"><path d="M1 16h41" fill="none" stroke="#1457ff" stroke-width="2.5" stroke-linecap="round"/><rect x="19" y="2" width="15" height="28" rx="3" fill="#f6f8fb" stroke="#0b1220" stroke-width="2.5"/><path d="M34 16l13 13h8" fill="none" stroke="#c9362b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="16" r="4" fill="#1457ff"/><rect x="38" y="12" width="8" height="8" rx="2" fill="#1457ff"/></svg>
        <span class="brand-name">Feedline</span>
        <span class="brand-status">Source supply for agents</span>
      </a>
      <div class="nav-links">
        <a href="#line">How it works</a>
        <a href="#outputs">Examples</a>
        <a href="https://github.com/ankaiinc/sourcefoundry">Open source</a>
        <a class="nav-cta" href="#agent">Connect your agent</a>
      </div>
    </div>
  </nav>

  <main>
    <header class="hero">
      <div class="shell">
        <div class="hero-grid">
          <div>
            <h1>Give your agent a source feed that stays fresh.</h1>
          </div>
          <div class="hero-side">
            <p>Feedline continuously checks RSS feeds and search providers, removes duplicate results, keeps the original links, and reports source failures. Your agent uses those results to build news feeds, trackers, briefs, and research.</p>
            <div class="hero-actions">
              <a class="button" href="#agent">Connect your coding agent <span aria-hidden="true">→</span></a>
              <a class="button secondary" href="#outputs">See examples</a>
            </div>
            <div class="hero-note"><span class="pulse" aria-hidden="true"></span>No dashboard. Your coding agent operates Feedline.</div>
          </div>
        </div>

        <div class="line-window" id="line" tabindex="0" aria-label="Animated diagram showing sources entering Feedline, duplicates being removed, and new results reaching an agent product">
          <div class="line-scene">
            <p class="scene-label">Sources in · new results out</p>
            <svg viewBox="0 0 1200 328" role="img" aria-labelledby="lineTitle lineDesc">
              <title id="lineTitle">Feedline source sorting process</title>
              <desc id="lineDesc">RSS, official sources, and search results merge into a line, duplicate results leave on a reject branch, and new results continue to an agent product.</desc>
              <g font-family="Spline Sans, sans-serif" fill="#0b1220">
                <text x="36" y="94" font-size="13" font-weight="600">VARIED SOURCES</text>
                <rect x="36" y="112" width="112" height="38" rx="19" fill="#fff" stroke="#566276" stroke-width="1.5"/><text x="92" y="136" text-anchor="middle" font-family="Spline Sans Mono, monospace" font-size="11" fill="#566276">RSS</text>
                <rect x="36" y="165" width="142" height="38" rx="5" fill="#fff" stroke="#566276" stroke-width="1.5"/><text x="107" y="189" text-anchor="middle" font-family="Spline Sans Mono, monospace" font-size="11" fill="#566276">OFFICIAL</text>
                <rect x="36" y="218" width="126" height="30" rx="15" fill="#d7dee8"/><text x="99" y="237" text-anchor="middle" font-family="Spline Sans Mono, monospace" font-size="10" fill="#566276">SEARCH</text>
                <path d="M148 131h47l47 53M178 184h64M162 233h33l47-49" fill="none" stroke="#b8c2d1" stroke-width="2"/>
                <path d="M242 184h922" fill="none" stroke="#1457ff" stroke-width="3" stroke-linecap="round"/>

                <g class="traveller"><rect x="254" y="170" width="28" height="28" rx="5" fill="#1457ff"/></g>
                <g class="traveller two"><circle cx="254" cy="184" r="13" fill="#1457ff"/></g>
                <g class="traveller three"><rect x="254" y="171" width="38" height="26" rx="13" fill="#1457ff"/></g>

                <text x="520" y="84" font-size="13" font-weight="600" text-anchor="middle">CLEANUP</text>
                <rect x="471" y="105" width="98" height="158" rx="6" fill="#fff" stroke="#0b1220" stroke-width="2.5"/>
                <rect x="490" y="124" width="60" height="120" rx="4" fill="#f6f8fb" stroke="#d7dee8" stroke-width="1.5"/>
                <rect class="scan" x="496" y="130" width="5" height="108" rx="2.5" fill="#c7f23a"/>
                <text x="520" y="286" font-family="Spline Sans Mono, monospace" font-size="9" text-anchor="middle" fill="#566276">STANDARDIZE · CHECK</text>

                <path d="M642 184l83 83h115" fill="none" stroke="#c9362b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <g class="reject-unit"><rect x="642" y="170" width="28" height="28" rx="5" fill="#c9362b"/></g>
                <rect x="715" y="254" width="27" height="27" rx="4" fill="#c9362b"/>
                <text x="778" y="291" font-family="Spline Sans Mono, monospace" font-size="9" fill="#8f2922">DUPLICATE DIVERTED</text>

                <text x="930" y="94" font-size="13" font-weight="600">NEW RESULTS</text>
                <g transform="translate(862 157)"><rect width="108" height="54" rx="6" fill="#fff" stroke="#1457ff" stroke-width="1.5"/><rect x="12" y="12" width="50" height="6" rx="3" fill="#1457ff"/><rect x="12" y="25" width="80" height="4" rx="2" fill="#d7dee8"/><text x="54" y="45" text-anchor="middle" font-family="Spline Sans Mono, monospace" font-size="8" fill="#566276">SOURCE · 09:42</text></g>
                <g transform="translate(990 157)"><rect width="108" height="54" rx="6" fill="#fff" stroke="#1457ff" stroke-width="1.5"/><rect x="12" y="12" width="64" height="6" rx="3" fill="#1457ff"/><rect x="12" y="25" width="80" height="4" rx="2" fill="#d7dee8"/><text x="54" y="45" text-anchor="middle" font-family="Spline Sans Mono, monospace" font-size="8" fill="#566276">SOURCE · 09:47</text></g>
                <path d="M1164 184l-14-8v16z" fill="#1457ff"/>
                <text x="1164" y="232" font-size="13" font-weight="600" text-anchor="end">TO YOUR PRODUCT →</text>
              </g>
            </svg>
          </div>
          <div class="mobile-line" aria-hidden="true"><span class="mobile-line-label">Sources in · new results out</span><div class="mobile-sources"><span class="mobile-source">RSS</span><span class="mobile-source">OFFICIAL</span><span class="mobile-source">SEARCH</span></div><span class="mobile-gate"></span><span class="mobile-reject"></span><span class="mobile-candidate"></span><span class="mobile-output">TO YOUR PRODUCT ↓</span></div>
        </div>
      </div>
    </header>

    <section class="truth-strip" aria-label="Product responsibility boundary">
      <div class="shell truth-inner">
        <div class="truth"><span>You tell your agent</span><strong>What to track, which sources to use, and how often to check.</strong></div>
        <div class="truth"><span>Feedline handles</span><strong>Fetching, retries, duplicate removal, original links, and failure monitoring.</strong></div>
        <div class="truth"><span>Your agent handles</span><strong>Choosing what matters, writing, ranking, and publishing.</strong></div>
      </div>
    </section>

    <section class="outputs" id="outputs">
      <div class="shell">
        <div class="reveal"><h2 class="section-title">One source operation. Many products your agent can make.</h2></div>
        <div class="output-layout reveal">
          <div class="output-tabs" aria-label="Feedline product examples">
            <button class="output-tab active" type="button" aria-pressed="true" data-output="news"><span>Vertical news feed</span><span>01</span></button>
            <button class="output-tab" type="button" aria-pressed="false" data-output="market"><span>Market tracker</span><span>02</span></button>
            <button class="output-tab" type="button" aria-pressed="false" data-output="brief"><span>Creator briefing</span><span>03</span></button>
            <button class="output-tab" type="button" aria-pressed="false" data-output="policy"><span>Policy watch</span><span>04</span></button>
            <button class="output-tab" type="button" aria-pressed="false" data-output="research"><span>Research stream</span><span>05</span></button>
          </div>
          <div class="output-display" aria-live="polite">
            <span class="output-kicker">Finished product · owned by your agent</span>
            <h3 id="output-name">A news product that does not wake up empty.</h3>
            <div class="output-rail" aria-hidden="true"></div>
            <div class="output-details">
              <div class="output-detail"><span>Sources checked</span><strong id="output-input">Publisher feeds, official sources, and specific search queries</strong></div>
              <div class="output-detail"><span>Feedline supplies</span><strong id="output-supply">New stories with their original links and source details</strong></div>
              <div class="output-detail"><span>Your agent adds</span><strong id="output-agent">Editorial selection, ranking, summaries, and presentation</strong></div>
              <div class="output-detail"><span>Maintenance removed</span><strong id="output-burden">Polling, duplicate announcements, stale feeds, and hidden failures</strong></div>
            </div>
            <span class="candidate-label">18 NEW · 4 DUPLICATES · 6/6 SOURCES HEALTHY</span>
          </div>
        </div>
      </div>
    </section>

    <section class="comparison">
      <div class="shell">
        <div class="reveal"><h2 class="section-title">Search gives your agent a pile. Feedline gives it a supply line.</h2></div>
        <div class="compare-visual reveal">
          <article class="compare-side">
            <h3>Search now</h3><p>Excellent for one question in this moment.</p>
            <div class="pile" aria-hidden="true"><div class="result-slip">RESULT · provider shape A · 10:02</div><div class="result-slip">RESULT · same announcement · 10:02</div><div class="result-slip">RESULT · provider shape B · 10:03</div></div>
            <div class="compare-outcome">Your agent starts again from zero next time.</div>
          </article>
          <div class="versus">versus</div>
          <article class="compare-side">
            <h3>Supply continuously</h3><p>Built for a product that must remain fresh.</p>
            <div class="supply-mini" aria-hidden="true"><span class="mini-candidate a"></span><span class="mini-gate"></span><span class="mini-reject"></span><span class="mini-candidate b"></span><span class="mini-candidate c"></span></div>
            <div class="compare-outcome">Your agent reads what is new and sees where supply failed.</div>
          </article>
        </div>
      </div>
    </section>

    <section class="mechanism" aria-labelledby="mechanism-title">
      <div class="shell">
        <div class="reveal"><h2 class="section-title" id="mechanism-title">Feedline checks your sources and gives your agent only what is new.</h2><p class="section-copy">It runs on a schedule, removes duplicate results, keeps the original links, and shows you when a source fails.</p></div>
        <div class="stages reveal">
          <div class="stage"><span class="stage-index">01</span><h3>Your agent sets it up</h3><p>Tell it what to track, which feeds or search queries to use, and how often to check.</p></div>
          <div class="stage"><span class="stage-index">02</span><h3>Feedline checks sources</h3><p>It reads RSS feeds and calls the search provider you choose.</p></div>
          <div class="stage"><span class="stage-index">03</span><h3>Feedline cleans results</h3><p>It uses one format, removes duplicate links, and keeps each original source.</p></div>
          <div class="stage"><span class="stage-index">04</span><h3>Your agent gets updates</h3><p>It reads only the new results and sees which sources failed or went stale.</p></div>
        </div>
        <div class="boundary reveal"><strong>Feedline does not decide what is true or important.</strong><span>Your agent decides what to use, write, rank, or publish.</span></div>
      </div>
    </section>

    <section class="agent-handoff" id="agent">
      <div class="shell agent-grid">
        <div class="reveal">
          <h2>Connect Feedline to your coding agent.</h2>
          <p class="lead">There is no Feedline dashboard. Your agent reads the setup guide, creates the feed, runs it, and retrieves new source items through MCP or REST.</p>
          <div class="agent-actions"><button class="button light" type="button" data-copy="${escapedPrompt}">Copy the agent prompt</button><a class="button" href="${origin}/agent.md">Open agent.md</a></div>
          <p class="agent-proof">MCP: build_source_feed · read_source_feed</p>
        </div>
        <div class="prompt-panel reveal">
          <div class="panel-top"><span>Prompt for your coding agent</span><span class="panel-status">Ready</span></div>
          <pre class="prompt-text">Open ${origin}/agent.md.

Set up Feedline and store SOURCEFOUNDRY_API_TOKEN in your secret store.

Build a recurring source feed from the sources I describe. Run it and return new source items with links, dates, original sources, completeness, and source health.

Do not rank, summarize, or publish unless I ask.</pre>
          <div class="panel-footer"><span>Credential enters the agent runtime—not the prompt.</span><button class="copy-button" type="button" data-copy="${escapedPrompt}">Copy prompt</button></div>
        </div>
      </div>
    </section>

    <section class="operating">
      <div class="shell">
        <div class="reveal"><h2 class="section-title">Use our hosted service, or run Feedline yourself.</h2><p class="section-copy">In either case, your coding agent connects through MCP or REST. There is no dashboard.</p></div>
        <div class="operating-list reveal">
          <article class="operating-row"><span class="operating-index">01 · HOSTED</span><h3>We run Feedline for you</h3><p>Your agent connects to our service. We run the API, database, schedules, and source monitoring.</p><code>GET ${origin}/agent.md</code></article>
          <article class="operating-row"><span class="operating-index">02 · SELF-HOST</span><h3>Run it on your infrastructure</h3><p>Deploy the open-source service. For search, use your own Tavily, Exa, or Serper account.</p><code>docker compose up --build</code></article>
          <article class="operating-row"><span class="operating-index">03 · AGENT ACCESS</span><h3>Connect through MCP or REST</h3><p>Hosted and self-hosted installations support the same workflow for your coding agent.</p><code>build_source_feed · read_source_feed</code></article>
        </div>
      </div>
    </section>

    <section class="final-line">
      <div class="final-content reveal">
        <h2>Keep your product supplied.</h2>
        <p>Tell your coding agent what to track. Feedline will keep checking the sources.</p>
        <div class="hero-actions" style="justify-content:center"><button class="button" type="button" data-copy="${escapedPrompt}">Copy prompt for your agent</button><a class="button secondary" href="https://github.com/ankaiinc/sourcefoundry">View the open-source repo</a></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="shell footer-inner">
      <div class="footer-note"><strong style="color:var(--ink)">Feedline</strong> is the public name for the open-source SourceFoundry service. Feedline collects and maintains source feeds; your agent decides what to publish.</div>
      <div class="footer-links"><a href="${origin}/agent.md">Agent guide</a><a href="${origin}/openapi.json">OpenAPI</a><a href="${origin}/.well-known/sourcefoundry.json">Service descriptor</a><a href="https://github.com/ankaiinc/sourcefoundry">GitHub</a><a href="https://4agents.fyi">4agents.fyi</a></div>
    </div>
  </footer>

  <div id="copy-status" role="status" aria-live="polite" style="position:fixed;left:50%;bottom:24px;z-index:100;transform:translate(-50%,20px);padding:10px 14px;border-radius:5px;background:#0b1220;color:#fff;font:11px 'Spline Sans Mono',monospace;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease">Copied for your agent</div>
  <script>
    const outputs = {
      news: { name:'A news product that does not wake up empty.', input:'Publisher feeds, official sources, and specific search queries', supply:'New stories with their original links and source details', agent:'Editorial selection, ranking, summaries, and presentation', burden:'Polling, duplicate announcements, stale feeds, and hidden failures' },
      market: { name:'A market tracker that remembers yesterday.', input:'Competitor blogs, filings, changelogs, and industry sources', supply:'New evidence since the last run in one consistent format', agent:'Choosing important updates, company mapping, alerts, and analysis', burden:'Repeated searches, provider response parsing, and matching the same story across sources' },
      brief: { name:'A briefing with fresh sources every morning.', input:'A creator’s trusted source list plus specific search queries', supply:'New results with duplicates removed, ready for review', agent:'Point of view, narrative, format, voice, and publication', burden:'Tab collecting, link bookkeeping, repeated stories, and dead feeds' },
      policy: { name:'A policy watch that never loses the official source.', input:'Government feeds, official pages, and selected search queries', supply:'New policy results with original links and source health', agent:'Legal interpretation, consequence, audience relevance, and escalation', burden:'Source checking, missing updates, lost links, and silent stalls' },
      research: { name:'A research stream that does not restart from zero.', input:'Known evidence sources and repeatable search queries', supply:'New results with dates, links, and completeness checks', agent:'Hypotheses, synthesis, confidence, citations, and conclusions', burden:'Fresh searches, duplicate review, provider lock-in, and lost context' }
    };
    document.querySelectorAll('.output-tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.output-tab').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-pressed','false'); });
      tab.classList.add('active'); tab.setAttribute('aria-pressed','true');
      const output = outputs[tab.dataset.output];
      document.querySelector('#output-name').textContent = output.name;
      document.querySelector('#output-input').textContent = output.input;
      document.querySelector('#output-supply').textContent = output.supply;
      document.querySelector('#output-agent').textContent = output.agent;
      document.querySelector('#output-burden').textContent = output.burden;
    }));
    const copyStatus = document.querySelector('#copy-status');
    let copyTimer;
    document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy); }
      catch { const area=document.createElement('textarea'); area.value=button.dataset.copy; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); }
      clearTimeout(copyTimer); copyStatus.style.opacity='1'; copyStatus.style.transform='translate(-50%,0)';
      copyTimer=setTimeout(() => { copyStatus.style.opacity='0'; copyStatus.style.transform='translate(-50%,20px)'; },1800);
    }));
  </script>
</body>
</html>`;
}
