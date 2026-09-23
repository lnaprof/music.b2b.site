/* ============================================================
   SOUNDPIPE — frontend logic
   i18n / nav / reveal / players / calculator / forms
   ============================================================ */
(function () {
  "use strict";

  /* ---------- API config ----------
     API_BASE: когда страница открыта с боевого сервера — оставьте пустым
     (запросы идут на тот же origin). При открытии index.html как файла
     укажите URL запущенного сервера, e.g. 'http://localhost:3000'.
     DEMO_FALLBACK: если сервер недоступен, заявки сохраняются в localStorage
     и в консоль — это демо-режим для презентации без бэкенда. */
  const API_BASE = "";
  const DEMO_FALLBACK = true;

  /* ---------- i18n ---------- */
  var lang = "ru";
  try { lang = localStorage.getItem("sp_lang") || "ru"; } catch (e) {}
  if (lang !== "ru" && lang !== "en") lang = "ru";

  function t(key) {
    var d = window.I18N[lang] || {};
    if (d[key] != null) return d[key];
    if (window.I18N.ru[key] != null) return window.I18N.ru[key];
    return key;
  }
  window.SP = { t: t, getLang: function () { return lang; } };

  function applyI18n() {
    document.documentElement.lang = lang === "en" ? "en" : "ru";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (window.__calc) window.__calc.update();
  }

  document.querySelectorAll(".lang-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.getAttribute("data-lang");
      try { localStorage.setItem("sp_lang", lang); } catch (e) {}
      applyI18n();
    });
  });

  /* ---------- mobile nav ---------- */
  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  function closeNav() { nav.classList.remove("open"); navToggle.setAttribute("aria-expanded", "false"); }
  navToggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", closeNav);
  });
  document.addEventListener("click", function (e) {
    if (nav.classList.contains("open") && !nav.contains(e.target) && !navToggle.contains(e.target)) closeNav();
  });

  /* ---------- reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function showToast(text, good) {
    toastEl.textContent = text;
    toastEl.classList.toggle("good", !!good);
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 400);
    }, 5200);
  }

  /* ============================================================
     BEFORE / AFTER players
     ============================================================ */
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function initPlayers() {
    document.querySelectorAll(".player").forEach(function (p) {
      var audio = p.querySelector("audio");
      var btn = p.querySelector('[data-action="play"]');
      var progress = p.querySelector(".pl-progress");
      var fill = p.querySelector(".pl-progress-fill");
      var nowDot = p.querySelector(".pl-progress-now");
      var time = p.querySelector(".pl-time");

      function update() {
        var d = audio.duration || 0;
        var c = audio.currentTime || 0;
        var pct = d ? (c / d) * 100 : 0;
        if (fill) fill.style.width = pct + "%";
        if (nowDot) nowDot.style.left = pct + "%";
        if (time) time.textContent = d ? fmtTime(c) + " / " + fmtTime(d) : "0:00 / 0:00";
      }

      btn.addEventListener("click", function () {
        stopOthers(p);
        if (audio.paused) {
          p.classList.add("playing");
          var pr = audio.play();
          if (pr && pr.catch) pr.catch(function () {
            p.classList.remove("playing");
            if (time) time.textContent = window.SP.t("misc.nofile");
          });
        } else {
          audio.pause();
          p.classList.remove("playing");
        }
      });

      progress.addEventListener("click", function (e) {
        if (!audio.duration) return;
        var r = progress.getBoundingClientRect();
        if (!r.width) return;
        var pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        audio.currentTime = pct * audio.duration;
        update();
      });

      audio.addEventListener("timeupdate", update);
      audio.addEventListener("loadedmetadata", update);
      audio.addEventListener("play", function () { p.classList.add("playing"); });
      audio.addEventListener("pause", function () { p.classList.remove("playing"); });
      audio.addEventListener("ended", function () { p.classList.remove("playing"); update(); });
      audio.addEventListener("error", function () {
        p.classList.remove("playing");
        if (time) time.textContent = "n/a";
      });
      update();
    });
  }

  function stopOthers(except) {
    document.querySelectorAll(".player.playing").forEach(function (op) {
      if (op === except) return;
      var oa = op.querySelector("audio");
      if (oa) { oa.pause(); oa.currentTime = 0; }
      op.classList.remove("playing");
    });
  }

  /* ============================================================
     CALCULATOR
     ============================================================ */
  var CALC_CFG = {
    mixing:   { base: 9900,  unit: "track", max: 60 },
    custom:   { base: 49900, unit: "track", max: 60 },
    retainer: { base: 3900,  unit: "min",   max: 120 }
  };
  function calcDisc(service, qty) {
    if (service === "retainer") {
      if (qty >= 60) return 0.15;
      if (qty >= 30) return 0.10;
      return 0;
    }
    if (qty >= 25) return 0.20;
    if (qty >= 10) return 0.10;
    return 0;
  }

  function initCalc() {
    var segBtns = document.querySelectorAll(".seg-btn");
    var qtyEl = document.getElementById("calcQty");
    var qtyVal = document.getElementById("calcQtyVal");
    var qtyLabel = document.getElementById("calcQtyLabel");
    var sumEl = document.getElementById("calcSum");
    var subEl = document.getElementById("calcSub");
    var service = "mixing";
    var ticks = document.querySelector(".calc-scale");

    function setFill() {
      var min = +qtyEl.min, max = +qtyEl.max;
      var pct = max > min ? ((+qtyEl.value - min) / (max - min)) * 100 : 0;
      qtyEl.style.setProperty("--fill", pct + "%");
    }

    function update() {
      var cfg = CALC_CFG[service];
      if (!cfg) return;
      qtyEl.max = String(cfg.max);
      var qty = Math.min(+qtyEl.value, cfg.max);
      var disc = calcDisc(service, qty);
      var minTotal = Math.round(qty * cfg.base * (1 - disc));
      var maxTotal = Math.round(minTotal * 1.2);

      qtyEl.value = String(qty);
      if (qtyVal) qtyVal.textContent = qty;
      if (qtyLabel) {
        qtyLabel.setAttribute("data-i18n", service === "retainer" ? "calc.qtyMin" : "calc.qty");
        qtyLabel.textContent = t(service === "retainer" ? "calc.qtyMin" : "calc.qty");
      }
      if (ticks) {
        if (service === "retainer") {
          ticks.innerHTML = "<span>1</span><span>30</span><span>60</span><span>90</span><span>120</span>";
        } else {
          ticks.innerHTML = "<span>1</span><span>15</span><span>30</span><span>45</span><span>60</span>";
        }
      }
      if (sumEl) {
        var fmtRub = function (n) { return n.toLocaleString("ru-RU"); };
        var txt = "\u2248 " + fmtRub(minTotal) + " \u2013 " + fmtRub(maxTotal) + " \u20BD";
        if (sumEl.textContent !== txt) {
          sumEl.textContent = txt;
          sumEl.classList.remove("bump");
          void sumEl.offsetWidth;
          sumEl.classList.add("bump");
        }
      }
      if (subEl) {
        var unitWord = cfg.unit === "min" ? t("misc.minutes") : t("misc.tracks");
        var discText = disc > 0
          ? t("calc.sub.disc").replace("{p}", String(Math.round(disc * 100)))
          : t("calc.sub.nodisc");
        subEl.textContent = t("calc.sub.tracks")
          .replace("{n}", String(qty))
          .replace("{unit}", unitWord)
          .replace("{disc}", discText);
      }
      setFill();
    }

    segBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        segBtns.forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        service = b.getAttribute("data-service");
        update();
      });
    });

    qtyEl.addEventListener("input", update);

    window.__calc = { update: update };
    update();
  }

  /* ============================================================
     FORMS
     ============================================================ */
  function postForm(url, fd) {
    var p = fetch(url, { method: "POST", body: fd });
    return Promise.resolve(p)
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok && data.ok) return { ok: true };
          return { ok: false, message: data.message };
        });
      })
      .catch(function () { return { ok: false, network: true }; });
  }

  function localSave(kind, data) {
    try {
      var arr = JSON.parse(localStorage.getItem("sp_leads") || "[]");
      arr.push(Object.assign({ kind: kind, ts: new Date().toISOString() }, data));
      localStorage.setItem("sp_leads", JSON.stringify(arr));
    } catch (e) {}
  }

  function formatBytes(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
  }

  function attachFileInput() {
    document.querySelectorAll('input[type="file"]').forEach(function (input) {
      var drop = input.closest(".form-field") ? input.closest(".form-field").querySelector(".file-drop") : null;
      input.addEventListener("change", function () {
        if (!drop) return;
        var f = input.files && input.files[0];
        var main = drop.querySelector(".file-drop-main");
        var hint = drop.querySelector(".file-drop-hint");
        if (f) {
          var name = f.name.length > 32 ? f.name.slice(0, 30) + "\u2026" : f.name;
          main.textContent = name;
          if (hint) hint.textContent = formatBytes(f.size) + " MB \u00b7 " + t("ft.filehint");
          drop.classList.add("has-file");
        } else {
          main.textContent = t("ft.filebtn");
          if (hint) hint.textContent = t("ft.filehint");
          drop.classList.remove("has-file");
        }
      });
    });
  }

  function initForm(conf) {
    var form = document.getElementById(conf.id);
    if (!form) return;
    var errEl = document.getElementById(conf.errorId);
    var success = document.getElementById(conf.successId);
    var submitBtn = form.querySelector('button[type="submit"]');

    function showErr(msg) {
      if (errEl) {
        errEl.textContent = msg || "";
        errEl.hidden = !msg;
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // honeypot: bots fill hidden fields
      var hp = form.querySelector('input[name="company_web"]');
      if (hp && hp.value) return;

      var name = (form.querySelector('[name="name"]') || {}).value || "";
      var email = (form.querySelector('[name="email"]') || {}).value || "";
      var company = (form.querySelector('[name="company"]') || {}).value || "";
      name = name.trim();
      email = email.trim();
      company = company.trim();

      if (!name || !email || (conf.needCompany && !company)) { showErr(t("ft.err.req")); return; }
      if (!/^\S+@\S+\.\S+$/.test(email)) { showErr(t("ft.err.email")); return; }

      var fd = new FormData();
      fd.append("name", name);
      fd.append("company", company);
      fd.append("email", email);
      fd.append("source", conf.source);

      var fileOK = true;
      if (conf.withFile) {
        var fileInput = form.querySelector('input[type="file"]');
        var agree = form.querySelector('input[name="agree"]');
        var file = fileInput && fileInput.files ? fileInput.files[0] : null;
        if (!agree || !agree.checked) { showErr(t("ft.err.agree")); return; }
        if (file) {
          var okExt = /\.(wav|mp3)$/i.test(file.name);
          var okMime = /(audio\/(wav|mpeg|x-wav))/.test(file.type);
          if (!(okExt || okMime) || file.size > 50 * 1024 * 1024) {
            showErr(t("ft.err.file"));
            return;
          }
          fd.append("audio", file, file.name);
          fd.append("fileName", file.name);
          fd.append("fileSize", String(file.size));
        } else {
          showErr(t("ft.err.file"));
          return;
        }
        fd.append("agree", "1");
      }

      if (conf.messageName) {
        var msg = (form.querySelector('[name="' + conf.messageName + '"]') || {}).value || "";
        fd.append("message", msg.trim());
      }

      showErr(null);
      var origLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = "\u2026";

      postForm(API_BASE + conf.endpoint, fd).then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = origLabel;
        if (res.ok) {
          form.classList.add("sent");
          success.hidden = false;
          setTimeout(function () {
            success.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 120);
        } else if (res.network && DEMO_FALLBACK) {
          // demo-mode fallback: keep the lead locally, show success
          var meta = { name: name, company: company, email: email, message: fd.get("message") || "" };
          if (conf.withFile) {
            var ff = form.querySelector('input[type="file"]').files[0];
            meta.fileName = ff ? ff.name : null;
            meta.fileSize = ff ? ff.size : 0;
          }
          localSave(conf.source, meta);
          console.warn("[SOUNDPIPE demo] Lead saved locally (no server). Payload:", meta);
          form.classList.add("sent");
          success.hidden = false;
          showToast(t("toast.demo"), true);
          setTimeout(function () {
            success.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 120);
        } else {
          showErr(res.message || t("ft.err.send"));
        }
      });
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    applyI18n();
    initPlayers();
    initCalc();
    attachFileInput();
    initForm({
      id: "form-test",
      errorId: "ft-error",
      successId: "ft-success",
      endpoint: "/api/lead/test",
      source: "test-track",
      withFile: true,
      messageName: null
    });
    initForm({
      id: "form-b2b",
      errorId: "b2b-error",
      successId: "b2b-success",
      endpoint: "/api/lead/b2b",
      source: "b2b-quote",
      withFile: false,
      needCompany: true,
      messageName: "message"
    });
    // re-apply sizing for the range fill on load
    if (window.__calc) window.__calc.update();
  });
})();