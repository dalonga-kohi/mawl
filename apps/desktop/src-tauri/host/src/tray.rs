//! What the tray icon and its status line say about the server.
//!
//! The match over [`Status`] has no wildcard on purpose: a new status must get a decision here.

use crate::machine::Status;

/// Which icon variant the tray shows. The names are stable so real art can replace the dots.
// TODO(mascot): the Pip mascot sheet does not exist yet (docs/DESIGN.md section 8, CLAUDE.md
// "Images and assets"). Until it does, `Ready` uses the app icon and every other variant puts a
// small status dot on it ([`dot_color`]). Swap the art in per variant here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayVariant {
    Ready,
    Starting,
    Restarting,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrayPresentation {
    /// Also the first line of the tray menu.
    pub tooltip: &'static str,
    pub variant: TrayVariant,
}

pub fn tray_presentation(status: Status) -> TrayPresentation {
    let (tooltip, variant) = match status {
        Status::Starting { .. } => ("Mawl is starting", TrayVariant::Starting),
        Status::Ready => ("Mawl is running", TrayVariant::Ready),
        Status::Restarting { .. } => ("Mawl is restarting", TrayVariant::Restarting),
        Status::Stopping => ("Mawl is stopping", TrayVariant::Stopping),
        Status::Stopped => ("Mawl has stopped", TrayVariant::Stopped),
        Status::Failed { .. } => ("Mawl could not start", TrayVariant::Failed),
    };
    TrayPresentation { tooltip, variant }
}

/// RGB of the status dot, `None` when the plain app icon is shown.
pub fn dot_color(variant: TrayVariant) -> Option<[u8; 3]> {
    match variant {
        TrayVariant::Ready => None,
        // Amber while the server is coming up or coming back.
        TrayVariant::Starting | TrayVariant::Restarting => Some([245, 158, 11]),
        // Grey while it shuts down.
        TrayVariant::Stopping | TrayVariant::Stopped => Some([148, 163, 184]),
        TrayVariant::Failed => Some([220, 38, 38]),
    }
}

/// Paints a filled dot into the bottom-right corner of an RGBA image (`width * height * 4`
/// bytes). The radius is a quarter of the shorter side. Does nothing when the buffer does not match
/// the size.
pub fn paint_status_dot(rgba: &mut [u8], width: u32, height: u32, color: [u8; 3]) {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 || rgba.len() != w * h * 4 {
        return;
    }
    let radius = (w.min(h) as f32) / 4.0;
    let (cx, cy) = (w as f32 - radius, h as f32 - radius);
    for y in 0..h {
        for x in 0..w {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            if dx * dx + dy * dy <= radius * radius {
                let i = (y * w + x) * 4;
                rgba[i..i + 3].copy_from_slice(&color);
                rgba[i + 3] = 255;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::{Failure, Stage};

    #[test]
    fn every_status_has_plain_copy_and_a_variant() {
        let reason = Failure::Unhealthy;
        let cases = [
            (
                Status::Starting {
                    stage: Stage::Database,
                },
                "Mawl is starting",
                TrayVariant::Starting,
            ),
            (
                Status::Starting {
                    stage: Stage::Server,
                },
                "Mawl is starting",
                TrayVariant::Starting,
            ),
            (Status::Ready, "Mawl is running", TrayVariant::Ready),
            (
                Status::Restarting {
                    attempt: 1,
                    reason,
                    retry_in_ms: None,
                },
                "Mawl is restarting",
                TrayVariant::Restarting,
            ),
            (
                Status::Restarting {
                    attempt: 3,
                    reason,
                    retry_in_ms: Some(4_000),
                },
                "Mawl is restarting",
                TrayVariant::Restarting,
            ),
            (Status::Stopping, "Mawl is stopping", TrayVariant::Stopping),
            (Status::Stopped, "Mawl has stopped", TrayVariant::Stopped),
            (
                Status::Failed { reason },
                "Mawl could not start",
                TrayVariant::Failed,
            ),
        ];
        for (status, tooltip, variant) in cases {
            let p = tray_presentation(status);
            assert_eq!(p.tooltip, tooltip, "{status:?}");
            assert_eq!(p.variant, variant, "{status:?}");
        }
    }

    #[test]
    fn only_the_ready_icon_has_no_dot() {
        assert_eq!(dot_color(TrayVariant::Ready), None);
        for v in [
            TrayVariant::Starting,
            TrayVariant::Restarting,
            TrayVariant::Stopping,
            TrayVariant::Stopped,
            TrayVariant::Failed,
        ] {
            assert!(dot_color(v).is_some(), "{v:?}");
        }
        assert_ne!(
            dot_color(TrayVariant::Failed),
            dot_color(TrayVariant::Restarting)
        );
    }

    #[test]
    fn the_dot_lands_in_the_bottom_right_corner_only() {
        let (w, h) = (16u32, 16u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        paint_status_dot(&mut rgba, w, h, [1, 2, 3]);
        let px = |x: usize, y: usize| &rgba[(y * 16 + x) * 4..(y * 16 + x) * 4 + 4];
        assert_eq!(px(13, 13), &[1, 2, 3, 255]);
        assert_eq!(px(0, 0), &[0, 0, 0, 0]);
        assert_eq!(px(15, 0), &[0, 0, 0, 0]);
        assert_eq!(px(0, 15), &[0, 0, 0, 0]);
    }

    #[test]
    fn a_buffer_of_the_wrong_size_is_left_alone() {
        let mut rgba = vec![7u8; 10];
        paint_status_dot(&mut rgba, 16, 16, [1, 2, 3]);
        assert_eq!(rgba, vec![7u8; 10]);
        paint_status_dot(&mut [], 0, 0, [1, 2, 3]);
    }
}
