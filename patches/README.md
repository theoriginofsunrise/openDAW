# Patches

Put a `.patch` file in this folder and the workflow **Apply uploaded patch** applies it to `main`, commits it and
pushes. The push starts the deploy to Cloudflare Pages. `applied.txt` lists what was applied, so a patch is never
applied twice. Patches are applied in alphabetical order of their file name.

## Upload a patch (no terminal needed)

1. Download the `.patch` file (on a phone it lands in the Files app).
2. On github.com open your fork, then the `patches` folder.
3. **Add file**, **Upload files**, choose the patch, **Commit changes**.
4. The **Actions** tab shows "Apply uploaded patch", then "Deploy phone fork to Cloudflare Pages". Green means done.

If "Apply uploaded patch" turns red, the log says which patch did not apply. Nothing is pushed in that case.

## One-time setup

The workflow needs a token that may change files and workflow files, because the built-in token can do neither
for patches that touch `.github/workflows`.

1. github.com, your profile photo, **Settings**, **Developer settings**, **Personal access tokens**,
   **Fine-grained tokens**, **Generate new token**.
2. Name `patch-bot`, expiry 90 days, **Only select repositories** and pick this repository.
3. Repository permissions: **Contents: Read and write**, **Workflows: Read and write** (Metadata stays read-only).
4. **Generate token** and copy it (it is shown once).
5. In the repository: **Settings**, **Secrets and variables**, **Actions**, **New repository secret**, name
   `PATCH_TOKEN`, paste the token.

When the token expires, make a new one and replace the secret. Never paste the token into a chat.
