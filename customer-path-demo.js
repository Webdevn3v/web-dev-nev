(function(){
  var stage = document.getElementById('stage');
  var qrGrid = document.getElementById('qrGrid');
  var qrPulse = document.getElementById('qrPulse');
  var transitionCopy = document.getElementById('transitionCopy');
  var replayBtn = document.getElementById('replayBtn');
  var closeBtn = document.getElementById('closeBtn');
  var playBtn = document.getElementById('playBtn');
  var staticSummary = document.getElementById('staticSummary');

  var timers = [];
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── decorative QR-style grid (not a real scannable code) ── */
  function buildQrGrid(){
    if(!qrGrid || qrGrid.children.length) return;
    var pattern = [
      1,1,1,0,1,1, 1,0,1,0,0,1, 1,1,1,0,1,0,
      0,0,0,0,1,1, 1,0,1,1,0,0, 1,1,0,1,1,1
    ];
    for(var i = 0; i < 36; i++){
      var cell = document.createElement('div');
      cell.className = 'qr-cell' + (pattern[i] ? ' on' : '');
      qrGrid.appendChild(cell);
    }
  }

  function clearTimers(){
    timers.forEach(function(t){ clearTimeout(t); });
    timers = [];
  }

  function at(ms, fn){
    timers.push(setTimeout(fn, ms));
  }

  function setScene(n){
    stage.dataset.scene = String(n);
  }

  function showCopy(text, lime){
    transitionCopy.textContent = text;
    transitionCopy.classList.toggle('lime-text', !!lime);
    transitionCopy.classList.add('show');
  }
  function hideCopy(){
    transitionCopy.classList.remove('show');
  }

  function play(){
    clearTimers();
    staticSummary.classList.remove('show');
    stage.classList.remove('rc-show');
    hideCopy();
    setScene(0);
    buildQrGrid();

    // force reflow so scene 0 -> scene 1 registers as a transition
    void stage.offsetWidth;

    at(50, function(){ setScene(1); });

    at(1500, function(){
      qrPulse.classList.remove('pulse');
      void qrPulse.offsetWidth;
      qrPulse.classList.add('pulse');
    });

    at(2800, function(){ setScene(2); showCopy('Key Detected'); });
    at(3150, function(){ showCopy('Route Established', true); });
    at(3500, function(){ showCopy('Access // Granted'); });

    at(3900, function(){ hideCopy(); setScene(3); });

    at(6300, function(){ setScene(4); });

    at(7900, function(){ setScene(5); });
    at(8700, function(){ stage.classList.add('rc-show'); });

    at(11000, function(){ setScene(6); });
  }

  function stopAndClose(){
    clearTimers();
    setScene(0);
    hideCopy();
    stage.classList.remove('rc-show');
    if(playBtn) playBtn.textContent = '▶ Reopen';
    staticSummary.classList.add('show');
  }

  replayBtn && replayBtn.addEventListener('click', play);
  closeBtn && closeBtn.addEventListener('click', stopAndClose);
  playBtn && playBtn.addEventListener('click', function(){
    if(reducedMotion) stage.classList.add('reduced');
    play();
  });

  buildQrGrid();

  if(reducedMotion){
    staticSummary.classList.add('show');
  }else{
    play();
  }
})();
