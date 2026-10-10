# Commercial plugins — Colourlab Ai and CrumplePop (Boris FX)

Neither product is purchased, downloaded or activated by the installer. `install\06-verify.ps1`
only checks whether they are already present and reports their paths.

## Colourlab Ai (Color Intelligence)

* What: AI shot matching, look design and colour management; runs as an **OFX plugin** inside Resolve (Windows supported since Colourlab Ai 3) and as a standalone app. Pro/Studio tiers add live grade sync with Resolve.
* Official site / installer: https://colourlab.ai/ (download from your account after purchase or trial). Official help centre: https://help.colourlab.ai/
* Requirements (from the vendor): Windows 10+, DaVinci Resolve 18+ (Studio recommended; the Resolve "Link" feature uses Resolve's scripting and the help centre notes a Python 3.6 dependency for that link — keep it separate from the `C:\AI-Video-Tools` venvs, it does not conflict).
* Install path to expect: `C:\Program Files\Common Files\OFX\Plugins\<Colourlab…>.ofx.bundle`. Resolve lists it under *Effects > OpenFX > Colourlab*.
* Steps: 1) create an account on the vendor site, 2) run the Windows installer, 3) start Resolve, 4) `06-verify.ps1` → row "Colourlab Ai (OFX)" should read *installed*, 5) run the `davinci-resolve-generate-plugin-list` skill (CiprianSpiridon server active) to refresh the plugin index, 6) `/bjj-color` will list it as an option for the hero-clip match.

## CrumplePop (Boris FX)

* What: audio clean-up suite (AudioDenoise, WindRemover, EchoRemover, RustleRemover, PopRemover, Levelmatic, VoiceGate, Traffic). On Windows these are **VST3** plugins (not OFX), usable in Resolve's Fairlight page and in the Edit page's clip effects.
* Official site / installer: https://borisfx.com/products/crumplepop/ via the **Boris FX Hub** installer/licence manager (https://borisfx.com/free-trial/ offers a no-card trial; a free Starter tier covers some filters, others run in trial mode with an audible watermark).
* Install path to expect: `C:\Program Files\Common Files\VST3\…`. Resolve: Fairlight page → Effects Library → VST3 → CrumplePop.
* Steps: 1) install Boris FX Hub, 2) install the CrumplePop suite from Hub, 3) start Resolve and check *Fairlight > Effects > VST3*, 4) `06-verify.ps1` → row "CrumplePop (Boris FX, VST3)" should read *installed*, 5) re-run the plugin-list skill.
* Workflow fit: crowd/HVAC noise under referee and coach audio (AudioDenoise), outdoor mats (WindRemover), hall echo on interviews (EchoRemover). Voice Isolation (Studio) covers part of this natively.

## Rules
No licence bypass, no unofficial installers, no account creation on your behalf. If either vendor's installer asks for admin rights, that is the vendor's requirement, not ours.
