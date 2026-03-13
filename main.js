document.addEventListener('DOMContentLoaded', () => {
  fetchAndDisplayData();
  document.getElementById('refreshBtn').addEventListener('click', fetchAndDisplayData);
  document.getElementById('dismissAlert').addEventListener('click', dismissTimeUpAlert);

  // Start the clock update
  updateAnalogClock();
  setInterval(updateAnalogClock, 1000);

  // Update remaining time every second
  setInterval(updateRemainingTime, 1000);

  // Load alert state from storage
  chrome.storage.local.get(['alertShown'], (result) => {
    window.alertShown = result.alertShown || false;
  });
});

let alertShown = false;



function fetchAndDisplayData() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.url?.startsWith("https://caliber.akriviahcm.com/time-attendance/UserAttendance")) {
      showNoData();
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeDataFromPage
    }, ([result]) => {
      if (!result || chrome.runtime.lastError) return showNoData();

      const { loginArr, logoutArr, breakArr } = result.result || {};
      if (!loginArr?.length) return showNoData();

      const totalBreakTime = calculateTotalBreakTime(breakArr);
      const outTime = calculateLogoutTime(loginArr[0], totalBreakTime);

      updatePopupUI(loginArr[0], totalBreakTime, outTime);

      // Store logout time for remaining time calculation
      localStorage.setItem('logoutTime', outTime);

      // Reset alert on data refresh
      alertShown = false;
      chrome.storage.local.set({ alertShown: false });
      const alert = document.getElementById('timeUpAlert');
      if (alert) {
        alert.classList.add('hidden');
      }

      updateRemainingTime();
    });
  });
}

function showNoData() {
  updatePopupUI('No data', 'No data', 'No data');
  document.getElementById('RemainingTime').textContent = 'No data';
}

function updatePopupUI(inTime, breakTime, logoutTime) {
  document.getElementById('InTime').textContent = inTime;
  document.getElementById('BreakTime').textContent = breakTime;
  document.getElementById('LogoutTime').textContent = logoutTime;
}

function scrapeDataFromPage() {
  const allLogTimes = document.querySelectorAll('.ah-log-timeline-list-item');
  const allBreakTimes = document.querySelectorAll('.ah-att-break-time');

  const loginArr = [];
  const logoutArr = [];
  const breakArr = [];

  allLogTimes.forEach(log => {
    const text = log.querySelector('.ah-text')?.textContent.trim();
    if (!text) return;
    if (log.classList.contains('ah-green')) loginArr.push(text);
    else if (log.classList.contains('ah-red')) logoutArr.push(text);
  });

  allBreakTimes.forEach(b => breakArr.push(b.textContent.trim()));

  return {
    loginArr: loginArr.reverse(),
    logoutArr: logoutArr.reverse(),
    breakArr
  };
}

function calculateTotalBreakTime(breakArr) {
  let hrs = 0, mins = 0, secs = 0;
  breakArr.forEach(b => {
    hrs += +(b.match(/(\d+)\s*h/)?.[1] || 0);
    mins += +(b.match(/(\d+)\s*m/)?.[1] || 0);
    secs += +(b.match(/(\d+)\s*s/)?.[1] || 0);
  });

  mins += Math.floor(secs / 60);
  secs %= 60;
  hrs += Math.floor(mins / 60);
  mins %= 60;

  return `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
}

function calculateLogoutTime(loginTime, totalBreak, totalHoursToStay = 8) {
  const inTime = parseTimeToDate(loginTime);
  const breakMs = parseDurationToMs(totalBreak);
  const workMs = totalHoursToStay * 3600000;
  return formatTime(new Date(inTime.getTime() + breakMs + workMs));
}

function parseTimeToDate(timeStr) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return new Date(`${dateStr} ${timeStr}`);
}

function parseDurationToMs(str) {
  const h = +(str.match(/(\d+)\s*h/)?.[1] || 0);
  const m = +(str.match(/(\d+)\s*m/)?.[1] || 0);
  const s = +(str.match(/(\d+)\s*s/)?.[1] || 0);
  return ((h * 3600) + (m * 60) + s) * 1000;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function pad(n) {
  return n.toString().padStart(2, '0');
}

function updateRemainingTime() {
  const logoutTimeStr = localStorage.getItem('logoutTime');

  if (!logoutTimeStr || logoutTimeStr === 'No data') {
    document.getElementById('RemainingTime').textContent = '--';
    return;
  }

  const now = new Date();
  const logoutTime = parseTimeToDate(logoutTimeStr);

  // If logout time is in the past, show "Completed" and alert
  if (now > logoutTime) {
    document.getElementById('RemainingTime').textContent = 'Completed';
    
    // Show time-up alert if not already shown
    if (!alertShown) {
      showTimeUpAlert();
      alertShown = true;
      chrome.storage.local.set({ alertShown: true });
    }
    return;
  }

  // Reset alert flag if time hasn't passed yet (in case of refresh)
  if (alertShown && now < logoutTime) {
    alertShown = false;
    chrome.storage.local.set({ alertShown: false });
    const alert = document.getElementById('timeUpAlert');
    if (alert) {
      alert.classList.add('hidden');
    }
  }

  // Calculate remaining time
  const diffMs = logoutTime - now;
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  document.getElementById('RemainingTime').textContent =
    `${pad(diffHrs)}h ${pad(diffMins)}m ${pad(diffSecs)}s`;
}

function updateAnalogClock() {
  const now = new Date();
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  // Standard clock rotation (clockwise)
  const hourDeg = (hours * 30) + (minutes * 0.5);
  const minuteDeg = minutes * 6;
  const secondDeg = seconds * 6;

  const hourHand = document.querySelector('.hour-hand');
  const minuteHand = document.querySelector('.minute-hand');
  const secondHand = document.querySelector('.second-hand');

  // Use will-change for better performance
  if (hourHand && minuteHand && secondHand) {
    hourHand.style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
    minuteHand.style.transform = `translateX(-50%) rotate(${minuteDeg}deg)`;
    secondHand.style.transform = `translateX(-50%) rotate(${secondDeg}deg)`;
  }
}

function showTimeUpAlert() {
  const alert = document.getElementById('timeUpAlert');
  if (alert) {
    alert.classList.remove('hidden');
  }
}

function dismissTimeUpAlert() {
  const alert = document.getElementById('timeUpAlert');
  if (alert) {
    alert.classList.add('hidden');
  }
}
