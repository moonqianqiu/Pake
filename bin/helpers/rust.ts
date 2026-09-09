import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import chalk from 'chalk';
import { execaSync } from 'execa';

import { getSpinner } from '@/utils/info';
import { isCnMirrorEnabled } from '@/utils/mirror';
import { IS_WIN } from '@/utils/platform';
import { shellExec } from '@/utils/shell';

function normalizePathForComparison(targetPath: string) {
  const normalized = path.normalize(targetPath);
  return IS_WIN ? normalized.toLowerCase() : normalized;
}

function getCargoHomeCandidates(): string[] {
  const candidates = new Set<string>();
  if (process.env.CARGO_HOME) {
    candidates.add(process.env.CARGO_HOME);
  }
  const homeDir = os.homedir();
  if (homeDir) {
    candidates.add(path.join(homeDir, '.cargo'));
  }
  if (IS_WIN && process.env.USERPROFILE) {
    candidates.add(path.join(process.env.USERPROFILE, '.cargo'));
  }
  return Array.from(candidates).filter(Boolean);
}

function ensureCargoBinOnPath() {
  const currentPath = process.env.PATH || '';
  const segments = currentPath.split(path.delimiter).filter(Boolean);
  const normalizedSegments = new Set(
    segments.map((segment) => normalizePathForComparison(segment)),
  );

  const additions: string[] = [];
  let cargoHomeSet = Boolean(process.env.CARGO_HOME);

  for (const cargoHome of getCargoHomeCandidates()) {
    const binDir = path.join(cargoHome, 'bin');
    if (
      fsExtra.pathExistsSync(binDir) &&
      !normalizedSegments.has(normalizePathForComparison(binDir))
    ) {
      additions.push(binDir);
      normalizedSegments.add(normalizePathForComparison(binDir));
    }

    if (!cargoHomeSet && fsExtra.pathExistsSync(cargoHome)) {
      process.env.CARGO_HOME = cargoHome;
      cargoHomeSet = true;
    }
  }

  if (additions.length) {
    const prefix = additions.join(path.delimiter);
    process.env.PATH = segments.length
      ? `${prefix}${path.delimiter}${segments.join(path.delimiter)}`
      : prefix;
  }
}

export function ensureRustEnv() {
  ensureCargoBinOnPath();
}

export async function installRust() {
  const spinner = getSpinner('Downloading Rust...');

  try {
    if (IS_WIN) {
      await shellExec({
        executable: 'winget',
        args: ['install', '--id', 'Rustlang.Rustup'],
      });
    } else {
      const useCnMirror = isCnMirrorEnabled();
      const tempDir = await fsExtra.mkdtemp(
        path.join(os.tmpdir(), 'pake-rustup-'),
      );
      try {
        const scriptPath = path.join(tempDir, 'rustup-init.sh');
        await shellExec({
          executable: 'curl',
          args: [
            '--proto',
            '=https',
            '--tlsv1.2',
            '-sSf',
            '-o',
            scriptPath,
            useCnMirror
              ? 'https://rsproxy.cn/rustup-init.sh'
              : 'https://sh.rustup.rs',
          ],
        });
        await shellExec(
          {
            executable: 'sh',
            args: useCnMirror ? [scriptPath] : [scriptPath, '-y'],
          },
          300000,
          useCnMirror
            ? {
                RUSTUP_DIST_SERVER: 'https://rsproxy.cn',
                RUSTUP_UPDATE_ROOT: 'https://rsproxy.cn/rustup',
              }
            : undefined,
        );
      } finally {
        await fsExtra.remove(tempDir);
      }
    }
    spinner.succeed(chalk.green('✔ Rust installed successfully!'));
    ensureRustEnv();
  } catch (error) {
    spinner.fail(chalk.red('✕ Rust installation failed!'));
    // The CLI owns error reporting and workspace/cache cleanup.
    throw error;
  }
}

export function checkRustInstalled() {
  ensureCargoBinOnPath();
  try {
    execaSync('rustc', ['--version']);
    return true;
  } catch {
    return false;
  }
}
