(() => {
    const clock = document.querySelector('#clock');
    const updateClock = () => {
        if (clock) {
            clock.textContent = new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).format(new Date());
        }
    };
    updateClock();
    window.setInterval(updateClock, 1000);

    const search = document.querySelector('#note-search');
    const cards = [...document.querySelectorAll('.note-card')];
    const emptyState = document.querySelector('#empty-state');
    search?.addEventListener('input', ({ target }) => {
        const query = target.value.trim().toLowerCase();
        let visible = 0;
        cards.forEach((card) => {
            const matches = card.dataset.note.includes(query);
            card.hidden = !matches;
            if (matches) visible += 1;
        });
        if (emptyState) emptyState.hidden = visible > 0;
    });

    const note = document.querySelector('#note-content');
    const lineCount = document.querySelector('#line-count');
    if (note && lineCount) {
        const lines = note.textContent.replace(/\n$/, '').split('\n').length;
        lineCount.textContent = `${String(lines).padStart(2, '0')} LINES`;
    }

    const copyButton = document.querySelector('#copy-note');
    copyButton?.addEventListener('click', async () => {
        if (!note) return;
        try {
            await navigator.clipboard.writeText(note.textContent);
            copyButton.innerHTML = '<span aria-hidden="true">[OK]</span> COPIED';
            window.setTimeout(() => {
                copyButton.innerHTML = '<span aria-hidden="true">[ ]</span> COPY';
            }, 1600);
        } catch {
            copyButton.textContent = 'COPY FAILED';
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.querySelector('.note-view')) {
            window.location.href = '/';
        }
    });
})();
