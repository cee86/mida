// No console window behind Mida on Windows (release builds).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mida_lib::run()
}
