document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const modelSelect = document.getElementById('modelSelect');
  const ratioCards = document.querySelectorAll('.ratio-card');
  const presetToggle = document.getElementById('presetToggle');
  const batchInput = document.getElementById('batchInput');
  const promptCounter = document.getElementById('promptCounter');
  const generateBtn = document.getElementById('generateBtn');
  
  const batchStatusText = document.getElementById('batchStatusText');
  const progressContainer = document.getElementById('progressContainer');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const imageGrid = document.getElementById('imageGrid');
  
  const retryFailedBtn = document.getElementById('retryFailedBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');

  // LogiQ Within Storybook Style Direction
  const STORYBOOK_STYLE_PRESET = "Clean dark ink line-art outlines, fine hatching and cross-hatching, muted earthy palette of ochre, sepia, washed-out brown, beige and soft cream, subtle watercolor and digital-wash shading, soft gradients, minimalist stylized environments, atmospheric storytelling backgrounds, realistic human proportions, cinematic storybook and graphic-novel realism, somber rustic reflective mood, consistent character appearance, expressive body language, detailed but uncluttered composition, no photorealism, no glossy 3D, no anime, no bright saturated colors.";

  // State
  let currentRatioObj = { w: 16, h: 9 };
  let currentAspectRatioStr = '16:9';
  let currentWidth = 1280;
  let currentHeight = 720;
  
  let jobs = [];
  let isGenerating = false;
  const CONCURRENCY_LIMIT = 3;

  // Ratio Selection
  ratioCards.forEach(card => {
    card.addEventListener('click', () => {
      ratioCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      const ratio = card.dataset.ratio;
      currentAspectRatioStr = ratio;
      
      if (ratio === '16:9') {
        currentRatioObj = { w: 16, h: 9 };
        currentWidth = 1280;
        currentHeight = 720;
      } else if (ratio === '1:1') {
        currentRatioObj = { w: 1, h: 1 };
        currentWidth = 1024;
        currentHeight = 1024;
      } else if (ratio === '9:16') {
        currentRatioObj = { w: 9, h: 16 };
        currentWidth = 720;
        currentHeight = 1280;
      }
    });
  });

  batchInput.addEventListener('input', updatePromptCounter);
  generateBtn.addEventListener('click', startBatchGeneration);

  retryFailedBtn.addEventListener('click', () => {
    const failedIndices = jobs
      .map((j, idx) => j.status === 'failed' ? idx : null)
      .filter(idx => idx !== null);
    
    if (failedIndices.length > 0) {
      processQueueIndices(failedIndices);
    }
  });

  // Download All as Ordered ZIP File
  downloadAllBtn.addEventListener('click', async () => {
    const completedJobs = jobs.filter(j => j.status === 'completed' && j.imageUrl);
    if (completedJobs.length === 0) return;

    downloadAllBtn.textContent = 'Packaging ZIP...';
    downloadAllBtn.disabled = true;

    try {
      const zip = new JSZip();
      const folder = zip.folder("LogiQ_Within_Visuals");

      // Fetch and add each image to the ZIP in exact sequential order (01, 02, 03...)
      for (const job of completedJobs) {
        const sceneFormatted = String(job.sceneNum).padStart(2, '0');
        const fileName = `Scene_${sceneFormatted}.png`;
        
        try {
          // Convert data URI or image URL to blob/array buffer
          const response = await fetch(job.imageUrl);
          const blob = await response.blob();
          folder.file(fileName, blob);
        } catch (err) {
          console.error(`Failed to add ${fileName} to ZIP:`, err);
        }
      }

      // Generate the ZIP file and trigger download
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `LogiQ_Within_Batch_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating ZIP:', err);
      alert('Failed to create ZIP package.');
    } finally {
      downloadAllBtn.textContent = 'Download All (ZIP)';
      downloadAllBtn.disabled = false;
    }
  });

  function parsePrompts() {
    return batchInput.value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 50);
  }

  function updatePromptCounter() {
    const count = parsePrompts().length;
    promptCounter.textContent = `${count} detected`;
  }

  function startBatchGeneration() {
    const rawPrompts = parsePrompts();
    if (rawPrompts.length === 0) {
      alert('Please enter at least one image prompt.');
      return;
    }

    jobs = rawPrompts.map((promptText, index) => ({
      id: `job_${index}_${Date.now()}`,
      sceneNum: index + 1,
      originalPrompt: promptText,
      finalPrompt: presetToggle.checked ? `${promptText}, ${STORYBOOK_STYLE_PRESET}` : promptText,
      status: 'pending',
      imageUrl: null,
      error: null
    }));

    renderGallery();
    processQueueIndices(jobs.map((_, idx) => idx));
  }

  async function processQueueIndices(indicesToProcess) {
    if (indicesToProcess.length === 0) return;

    isGenerating = true;
    updateUIState();

    indicesToProcess.forEach(idx => {
      jobs[idx].status = 'pending';
      jobs[idx].error = null;
      updateCardUI(idx);
    });

    let queue = [...indicesToProcess];
    let activeWorkers = 0;

    return new Promise((resolve) => {
      function next() {
        if (queue.length === 0 && activeWorkers === 0) {
          isGenerating = false;
          updateUIState();
          resolve();
          return;
        }

        while (activeWorkers < CONCURRENCY_LIMIT && queue.length > 0) {
          const jobIndex = queue.shift();
          activeWorkers++;
          
          executeJob(jobIndex).then(() => {
            activeWorkers--;
            updateProgress();
            next();
          });
        }
      }

      next();
    });
  }

  async function executeJob(index) {
    const job = jobs[index];
    job.status = 'generating';
    updateCardUI(index);

    try {
      if (typeof puter === 'undefined' || !puter.ai || !puter.ai.txt2img) {
        throw new Error('Puter.js library failed to load.');
      }

      const options = {
        ratio: currentRatioObj,
        aspect_ratio: currentAspectRatioStr,
        width: currentWidth,
        height: currentHeight
      };

      const imageElement = await puter.ai.txt2img(job.finalPrompt, options);

      if (imageElement && imageElement.src) {
        job.status = 'completed';
        job.imageUrl = imageElement.src;
      } else {
        job.status = 'failed';
        job.error = 'Empty image source received.';
      }
    } catch (err) {
      console.error('Puter Generation Error:', err);
      job.status = 'failed';
      job.error = err.message || 'Generation failed.';
    }

    updateCardUI(index);
  }

  function renderGallery() {
    imageGrid.innerHTML = '';
    
    if (jobs.length === 0) {
      imageGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-box">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </div>
          <h3>Workspace Empty</h3>
          <p>Enter your video script prompts on the left sidebar and click <strong>Generate Batch</strong> to begin rendering scene assets.</p>
        </div>`;
      return;
    }

    jobs.forEach((job, index) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.id = `card_${index}`;
      card.innerHTML = getCardHTML(job);
      imageGrid.appendChild(card);
      attachCardEvents(card, index);
    });
  }

  function getCardHTML(job) {
    const sceneFormatted = String(job.sceneNum).padStart(2, '0');
    
    let statusBadge = `<span class="status-tag pending">Pending</span>`;
    if (job.status === 'generating') statusBadge = `<span class="status-tag generating">Rendering...</span>`;
    if (job.status === 'completed') statusBadge = `<span class="status-tag completed">✓ Done</span>`;
    if (job.status === 'failed') statusBadge = `<span class="status-tag failed">Failed</span>`;

    let previewContent = `<div class="card-placeholder">In queue...</div>`;
    if (job.status === 'generating') {
      previewContent = `<div class="card-placeholder">Rendering 16:9 scene...</div>`;
    } else if (job.status === 'completed' && job.imageUrl) {
      previewContent = `<img src="${job.imageUrl}" alt="Scene ${sceneFormatted}">`;
    } else if (job.status === 'failed') {
      previewContent = `<div class="card-placeholder" style="color: var(--status-failed-text);">${job.error || 'Failed'}</div>`;
    }

    return `
      <div class="card-top">
        <span>Scene ${sceneFormatted}</span>
        ${statusBadge}
      </div>
      <div class="card-img-wrapper">
        ${previewContent}
      </div>
      <div class="card-content">
        <div class="card-prompt">${escapeHtml(job.originalPrompt)}</div>
        <div class="card-btn-row">
          ${job.status === 'completed' ? `<button class="outline-btn download-btn">Download</button>` : ''}
          <button class="secondary-btn edit-btn">Edit</button>
          ${job.status === 'failed' || job.status === 'completed' ? `<button class="secondary-btn retry-btn">Retry</button>` : ''}
        </div>
      </div>
    `;
  }

  function updateCardUI(index) {
    const card = document.getElementById(`card_${index}`);
    if (card) {
      card.innerHTML = getCardHTML(jobs[index]);
      attachCardEvents(card, index);
    }
  }

  function attachCardEvents(card, index) {
    const downloadBtn = card.querySelector('.download-btn');
    const editBtn = card.querySelector('.edit-btn');
    const retryBtn = card.querySelector('.retry-btn');

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const sceneFormatted = String(jobs[index].sceneNum).padStart(2, '0');
        downloadSingleImage(jobs[index].imageUrl, `Scene_${sceneFormatted}.png`);
      });
    }

    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const newPrompt = prompt('Edit prompt for Scene ' + jobs[index].sceneNum + ':', jobs[index].originalPrompt);
        if (newPrompt !== null && newPrompt.trim() !== '') {
          jobs[index].originalPrompt = newPrompt.trim();
          jobs[index].finalPrompt = presetToggle.checked ? `${jobs[index].originalPrompt}, ${STORYBOOK_STYLE_PRESET}` : jobs[index].originalPrompt;
          processQueueIndices([index]);
        }
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        processQueueIndices([index]);
      });
    }
  }

  function updateProgress() {
    const total = jobs.length;
    if (total === 0) return;

    const finished = jobs.filter(j => j.status === 'completed' || j.status === 'failed').length;
    const percentage = Math.round((finished / total) * 100);

    progressText.textContent = `Processing ${finished} / ${total}`;
    progressPercent.textContent = `${percentage}%`;
    progressBarFill.style.width = `${percentage}%`;

    batchStatusText.textContent = `Batch progress: ${finished} of ${total} finished.`;
  }

  function updateUIState() {
    if (isGenerating) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating Batch...';
      progressContainer.style.display = 'block';
    } else {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Generate Batch`;
      
      const hasFailed = jobs.some(j => j.status === 'failed');
      const hasCompleted = jobs.some(j => j.status === 'completed');
      
      retryFailedBtn.style.display = hasFailed ? 'inline-block' : 'none';
      downloadAllBtn.style.display = hasCompleted ? 'inline-block' : 'none';
      
      if (hasCompleted) {
        downloadAllBtn.textContent = 'Download All (ZIP)';
      }
    }
  }

  function downloadSingleImage(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});