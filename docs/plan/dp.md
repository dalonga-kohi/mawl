# DP — Projects *(added 2026-10-24, REDESIGN R18)*

Part of the [Mawl plan](../PLAN.md). Status legend and slice template are there.

Goal: a project is the shared context a group of teammates works in: the brief, guidelines and voice, brand, reference files, linked folders, threads, canvases and routines. A teammate that is not a member sees none of it.

- [ ] **DP1 Project entity.** (head-coder: migration + contracts) `projects` (name, slug, brief, guidelines, created and archived), `project_members` (project, profile), nullable `threads.project_id`, project-scoped `folder_grants` (D3.H1), RPC `projects.list/get/create/update/archive` and `projects.members.*`, `project.updated` events. A thread belongs to at most one project. *Tests:* migration up and down on PGlite and Testcontainers, a non-member cannot read the project through any RPC.
- [ ] **DP2 Project prompt block.** (head-coder: prompt layout; the owner approves the text, as for D2.1) A `project` block after the persona: brief, guidelines and voice, capped (decide the cap in the slice), quoted as untrusted owner data, frozen per segment. Update MEMORY §7 and the snapshot tests in the same commits.
- [ ] **DP3 Reference library.** (head-coder: uploads and untrusted content) Uploads (drag and drop, the file picker) stored as artifacts with a `project_id`; text extracted from PDF, DOCX, Markdown and plain text; images kept for vision models. Tools `project_files_list`, `project_files_read`, `project_files_search` (FTS now, hybrid recall after D4.3), every result wrapped as untrusted data. Caps per file and per project. Linked folders from D3.H1 appear beside the uploads.
- [ ] **DP4 Projects UI.** (head-coder: UI) A Projects section in the sidebar; the project page (overview with brief and guidelines, teammates, files, threads; canvases and routines when those exist); create and archive flows; starting a chat inside a project. Loading, empty, error and success states; 390 px.
- [ ] **DP5 Brand kit.** (was DC14; after Beta 1) Colors, fonts, logo and voice per project, editable in the project page, read by the canvas skills and the copy skills.
- [ ] **DP6 Project memory.** (after D4.4) Project-scoped core blocks and facts shared by the members; the Memory UI filters by project.

