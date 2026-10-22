//! Windows logoff, shutdown and wake from sleep, as window messages.
//!
//! tao (the window layer under Tauri 0.37) answers `WM_ENDSESSION` by exiting the process on the
//! spot, with no `ExitRequested`, so the server and its Postgres would be ended by the job object
//! instead of being stopped cleanly. A window subclass sees the message first. What each message
//! means is decided in `mawl_host::session`; this file only receives them and carries it out.
//! It is the only place with `unsafe`, and every block says why it is sound.
//!
//! Not verified without a real logoff, shutdown and sleep on Windows (see docs/ARCHITECTURE.md).

use std::iter::once;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use mawl_host::session::{
    session_action, wait_bounded, SessionAction, END_SESSION_WAIT, PBT_APMRESUMEAUTOMATIC,
    WAIT_STEP, WM_ENDSESSION, WM_POWERBROADCAST, WM_QUERYENDSESSION,
};
use tauri::{AppHandle, Manager};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows_sys::Win32::System::Shutdown::{ShutdownBlockReasonCreate, ShutdownBlockReasonDestroy};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{EnumThreadWindows, WM_NCDESTROY};

use crate::shell::{self, Shell};

// The numbers `mawl_host::session` uses must be Windows' own.
const _: () = {
    assert!(WM_QUERYENDSESSION == windows_sys::Win32::UI::WindowsAndMessaging::WM_QUERYENDSESSION);
    assert!(WM_ENDSESSION == windows_sys::Win32::UI::WindowsAndMessaging::WM_ENDSESSION);
    assert!(WM_POWERBROADCAST == windows_sys::Win32::UI::WindowsAndMessaging::WM_POWERBROADCAST);
    assert!(
        PBT_APMRESUMEAUTOMATIC
            == windows_sys::Win32::UI::WindowsAndMessaging::PBT_APMRESUMEAUTOMATIC
    );
};

/// Shown by Windows next to "shut down anyway" while the server stops.
const BLOCK_REASON: &str = "Mawl is saving your work";
/// Identifies this subclass on a window ("MAWL").
const SUBCLASS_ID: usize = 0x4D41_574C;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The main window's handle: the wake from sleep is broadcast to every top-level window, and the
/// supervisor is asked once.
static MAIN_HWND: AtomicUsize = AtomicUsize::new(0);

/// Subclasses the main window and the other top-level windows of this (the UI) thread, which
/// includes tao's hidden message window that does the exit on `WM_ENDSESSION`. Call once, on the
/// UI thread, after the main window exists.
pub fn install(app: &AppHandle, main: usize) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    MAIN_HWND.store(main, Ordering::SeqCst);
    // SAFETY: `EnumThreadWindows` only reads the thread's window list and calls `subclass_window`
    // (a function with the exact signature it expects) once per window, on this thread, before
    // it returns. The thread id is our own thread's, from `GetCurrentThreadId`.
    unsafe {
        EnumThreadWindows(GetCurrentThreadId(), Some(subclass_window), 0);
    }
}

/// `WNDENUMPROC`.
///
/// # Safety
/// Called by `EnumThreadWindows` with a valid window handle of this thread.
unsafe extern "system" fn subclass_window(hwnd: HWND, _lparam: LPARAM) -> BOOL {
    // SAFETY: `hwnd` is a live window owned by the calling thread (the enumeration gave it to us),
    // and `SetWindowSubclass` must be called from the thread that owns the window, which it is.
    // `window_proc` has the `SUBCLASSPROC` signature. We pass no reference data (0). A failure
    // only means this window is not watched, so the result is ignored.
    unsafe {
        SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, 0);
    }
    TRUE // keep enumerating
}

/// `SUBCLASSPROC`: runs before the window's own procedure, on the UI thread.
///
/// # Safety
/// Called by the OS with the arguments of a window message for a window we subclassed.
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCDESTROY {
        // SAFETY: the window is being destroyed on its own thread; the subclass was set with this
        // same procedure and id, so removing it here is the documented cleanup.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID);
        }
    } else if let Some(app) = APP.get() {
        match session_action(msg, wparam) {
            SessionAction::AllowAndStopServer => {
                block_shutdown(hwnd);
                shell::begin_quit(app);
                // Never veto: TRUE lets the session end.
                return TRUE as LRESULT;
            }
            SessionAction::WaitForStop => {
                // A session end that arrives without the query (a restart by the Restart
                // Manager, say) still stops the server first. `begin_quit` runs once.
                shell::begin_quit(app);
                let stopped = || app.try_state::<Shell>().is_none_or(|s| s.may_exit());
                wait_bounded(stopped, END_SESSION_WAIT, WAIT_STEP);
                unblock_shutdown(hwnd);
            }
            SessionAction::EndCancelled => unblock_shutdown(hwnd),
            SessionAction::ProbeNow => {
                if hwnd as usize == MAIN_HWND.load(Ordering::SeqCst) {
                    if let Some(shell) = app.try_state::<Shell>() {
                        shell.supervisor.probe_now();
                    }
                }
            }
            SessionAction::Ignore => {}
        }
    }
    // SAFETY: forwards the same message to the next procedure in the subclass chain, as
    // `DefSubclassProc` requires, from within a subclass procedure.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn block_shutdown(hwnd: HWND) {
    let reason: Vec<u16> = BLOCK_REASON.encode_utf16().chain(once(0)).collect();
    // SAFETY: `hwnd` is the window that received the message; `reason` is a NUL-terminated UTF-16
    // string that outlives the call (Windows copies it).
    unsafe {
        ShutdownBlockReasonCreate(hwnd, reason.as_ptr());
    }
}

fn unblock_shutdown(hwnd: HWND) {
    // SAFETY: `hwnd` is the window that received the message. Destroying a reason that was never
    // created, or already destroyed, just returns FALSE.
    unsafe {
        ShutdownBlockReasonDestroy(hwnd);
    }
}
