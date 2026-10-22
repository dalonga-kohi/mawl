//! One server process: spawned without a shell or console window, with a cleared environment,
//! inside its own kill-on-close job object, and with stdin held open for its whole life.
//!
//! Order matters: the job exists before the spawn, the child joins it before it gets the token,
//! and the server reads the token before it starts Postgres. So every process the server starts
//! is already in the job, and ending the job (or the host dying, which closes the handle) takes
//! the whole tree down. That also covers a stdin pipe handle leaked into another child by
//! Windows handle inheritance, which would otherwise hide the host's death from the server.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::launch::ServerCommand;
use crate::master_key::{wipe, MasterKey};
use crate::token::LaunchToken;

/// Longest single line read from the server's output before it is cut.
const MAX_READ_LINE: u64 = 64 * 1024;
const WAIT_POLL: Duration = Duration::from_millis(100);

pub struct ServerProcess {
    pid: u32,
    stdin: Option<ChildStdin>,
    child: Arc<Mutex<Child>>,
    #[cfg(windows)]
    job: job::Job,
}

impl ServerProcess {
    /// Starts the server and writes its two stdin lines: the launch token, then the master key.
    /// `cwd` should be the data dir, never the install dir. On error nothing is left running.
    pub fn spawn(
        command: &ServerCommand,
        env: &[(String, String)],
        cwd: &Path,
        token: &LaunchToken,
        key: &MasterKey,
    ) -> io::Result<Self> {
        #[cfg(windows)]
        let job = job::Job::kill_on_close()?;

        let mut cmd = Command::new(&command.program);
        cmd.arg(&command.script)
            .env_clear()
            .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;

        // The child joins the job just after it starts, not suspended (std has no
        // CREATE_SUSPENDED + resume). That gap is safe: until the token line below arrives, the
        // server only parses its env and waits on stdin (`readLaunchToken` runs before
        // `startServer`), so it cannot have started Postgres or any other process yet. If joining
        // fails, the child is killed and the spawn fails.
        #[cfg(windows)]
        if let Err(err) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }

        let mut stdin = child.stdin.take().expect("stdin is piped");
        let wrote = write_secrets(&mut stdin, token, key);
        if let Err(err) = wrote {
            #[cfg(windows)]
            job.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }

        Ok(Self {
            pid: child.id(),
            stdin: Some(stdin),
            child: Arc::new(Mutex::new(child)),
            #[cfg(windows)]
            job,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The server's stdout and stderr, once each; `None` after the first call.
    pub fn take_output(&mut self) -> (Option<ChildStdout>, Option<ChildStderr>) {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        (child.stdout.take(), child.stderr.take())
    }

    /// EOF on the server's stdin: its watchdog then shuts it down cleanly.
    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    pub fn stdin_open(&self) -> bool {
        self.stdin.is_some()
    }

    /// Ends the whole tree now: the server, its Postgres and anything else they started.
    pub fn kill(&self) {
        #[cfg(windows)]
        self.job.terminate();
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let _ = child.kill();
    }

    /// Calls `on_exit` from a background thread once the server process has ended.
    pub fn watch_exit(&self, on_exit: impl FnOnce(Option<i32>) + Send + 'static) {
        let child = Arc::clone(&self.child);
        thread::spawn(move || loop {
            let status = child.lock().unwrap_or_else(|e| e.into_inner()).try_wait();
            match status {
                Ok(Some(status)) => return on_exit(status.code()),
                Ok(None) => thread::sleep(WAIT_POLL),
                Err(_) => return on_exit(None),
            }
        });
    }
}

impl Drop for ServerProcess {
    /// Whatever the server left behind (an orphaned Postgres after a crash) ends with it.
    fn drop(&mut self) {
        self.stdin = None;
        #[cfg(windows)]
        self.job.terminate();
    }
}

/// Writes `<token>\n<key>\n` in one write, from a buffer that is wiped afterwards.
pub fn write_secrets(out: &mut impl Write, token: &LaunchToken, key: &MasterKey) -> io::Result<()> {
    let mut line = Vec::with_capacity(token.expose().len() + key.expose().len() + 2);
    line.extend_from_slice(token.expose().as_bytes());
    line.push(b'\n');
    line.extend_from_slice(key.expose().as_bytes());
    line.push(b'\n');
    let wrote = out.write_all(&line).and_then(|()| out.flush());
    wipe(&mut line);
    wrote
}

/// Reads `reader` line by line on a background thread until EOF. Lines longer than 64 KiB are
/// split, so a runaway line cannot grow memory without bound.
///
/// A split must never cut the launch token in two: each half would pass the ring's redaction.
/// So when a line is cut, its last [`SPLIT_CARRY`] bytes (more than a token) start the next
/// piece instead, and a token that straddled the cut arrives whole in one piece.
pub fn read_lines(
    reader: impl Read + Send + 'static,
    mut on_line: impl FnMut(String) + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buf = Vec::new();
        let mut carry = Vec::new();
        loop {
            buf.clear();
            buf.append(&mut carry);
            let room = MAX_READ_LINE - buf.len() as u64;
            match (&mut reader).take(room).read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => {
                    if !buf.is_empty() {
                        on_line(String::from_utf8_lossy(&buf).into_owned());
                    }
                    return;
                }
                Ok(_) => {
                    if !buf.ends_with(b"\n") && buf.len() as u64 >= MAX_READ_LINE {
                        carry = buf.split_off(buf.len() - SPLIT_CARRY);
                    }
                    on_line(String::from_utf8_lossy(&buf).into_owned());
                }
            }
        }
    });
}

/// Bytes moved from a cut line to the next piece: longer than the launch token and the master key
/// (43 characters each).
pub const SPLIT_CARRY: usize = 128;
const _: () = assert!(SPLIT_CARRY > crate::token::TOKEN_CHARS);
const _: () = assert!(SPLIT_CARRY > crate::master_key::KEY_CHARS);

#[cfg(windows)]
mod job {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// An unnamed job object that kills its processes when its last handle closes: on drop, and
    /// when the host process dies for any reason.
    pub struct Job(HANDLE);

    // SAFETY: a job handle is a kernel object handle, usable from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close() -> io::Result<Self> {
            // SAFETY: no security attributes and no name; the result is checked.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Job(handle);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: valid job handle, pointer and size of the matching info class.
            let ok = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            // SAFETY: both handles are valid for the duration of the call.
            let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn terminate(&self) {
            // SAFETY: valid job handle. Failing (already empty) is fine.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: we own the handle and close it once.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::master_key::{resolve, MemoryStore};

    #[test]
    fn the_secrets_go_as_two_lines_token_first_then_the_key() {
        let token = LaunchToken::generate().unwrap();
        let dir = std::env::temp_dir().join(format!("mawl-process-lines-{}", std::process::id()));
        let (key, _) = resolve(&MemoryStore::default(), &dir).unwrap();
        let mut out = Vec::new();
        write_secrets(&mut out, &token, &key).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(text, format!("{}\n{}\n", token.expose(), key.expose()));
        assert_eq!(text.lines().count(), 2);
    }
}
