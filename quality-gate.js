#!/usr/bin/env node

/**
 * Quality Gate Script
 * Runs ESLint fix, build, and unit tests
 */

const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runCommand(command, description) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(`${description}`, colors.blue);
  log(`${'='.repeat(60)}`, colors.cyan);

  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: __dirname
    });
    log(`✓ ${description} completed successfully`, colors.green);
    return true;
  } catch (error) {
    log(`✗ ${description} failed`, colors.red);
    return false;
  }
}

function checkDependencies() {
  log('\nChecking dependencies...', colors.cyan);

  const requiredDeps = ['eslint', 'jest'];
  const missingDeps = [];

  requiredDeps.forEach(dep => {
    try {
      require.resolve(dep);
    } catch (e) {
      missingDeps.push(dep);
    }
  });

  if (missingDeps.length > 0) {
    log(`\n⚠ Missing dependencies: ${missingDeps.join(', ')}`, colors.yellow);
    log('Installing missing dependencies...', colors.cyan);
    try {
      execSync(`npm install --save-dev ${missingDeps.join(' ')}`, {
        stdio: 'inherit',
        cwd: __dirname
      });
      log('✓ Dependencies installed', colors.green);
    } catch (error) {
      log('✗ Failed to install dependencies', colors.red);
      return false;
    }
  } else {
    log('✓ All dependencies available', colors.green);
  }

  return true;
}

function main() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('  QUALITY GATE - Nostalgia Extension', colors.blue);
  log('='.repeat(60), colors.cyan);

  const startTime = Date.now();
  let allPassed = true;

  // Step 1: Check dependencies
  if (!checkDependencies()) {
    process.exit(1);
  }

  // Step 2: Run ESLint fix
  log('\n📋 Step 1/3: Running ESLint with auto-fix...', colors.cyan);
  if (!runCommand('npx eslint --fix "*.js" "**/*.js" --ignore-pattern "node_modules/**" --ignore-pattern "dist/**"', 'ESLint Fix')) {
    allPassed = false;
    log('\n⚠ ESLint found issues that could not be auto-fixed', colors.yellow);
    log('Please review and fix manually, then run again.', colors.yellow);
  }

  // Step 3: Build
  log('\n📦 Step 2/3: Building extension...', colors.cyan);
  if (!runCommand('npm run build', 'Build')) {
    allPassed = false;
  }

  // Step 4: Run tests
  log('\n🧪 Step 3/3: Running unit tests...', colors.cyan);
  if (!runCommand('npx jest --coverage', 'Unit Tests')) {
    allPassed = false;
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log('\n' + '='.repeat(60), colors.cyan);

  if (allPassed) {
    log('✓ QUALITY GATE PASSED', colors.green);
    log(`  Duration: ${duration}s`, colors.cyan);
    log('='.repeat(60), colors.cyan);
    process.exit(0);
  } else {
    log('✗ QUALITY GATE FAILED', colors.red);
    log(`  Duration: ${duration}s`, colors.cyan);
    log('  Please fix the issues above and try again.', colors.yellow);
    log('='.repeat(60), colors.cyan);
    process.exit(1);
  }
}

main();

