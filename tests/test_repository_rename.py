"""Offline regression checks for renamed checkout defaults and retained aliases."""
import importlib.util
import json
import tempfile
from unittest.mock import patch
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('forge_guest', ROOT / 'scripts/guest.py')
guest = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guest
spec.loader.exec_module(guest)


class RepositoryNames(unittest.TestCase):
    def test_canonical_defaults_keep_saved_keys(self):
        args = guest.setup_parser().parse_args([])
        self.assertEqual(args.birbcrew_source, ROOT.parent / 'crew')
        self.assertEqual(args.birbverify_source, ROOT.parent / 'verify')
        self.assertEqual(set(guest.PINS), {'birbcrew', 'birbverify'})

    def test_old_and_new_options_resolve_to_identical_configuration(self):
        new = guest.setup_parser().parse_args(['--crew-source', '/crew', '--verify-source', '/verify', '--crew-export', '/c-export', '--verify-export', '/v-export'])
        old = guest.setup_parser().parse_args(['--birbcrew-source', '/crew', '--birbverify-source', '/verify', '--birbcrew-export', '/c-export', '--birbverify-export', '/v-export'])
        self.assertEqual(vars(new), vars(old))


    def test_producer_aliases_use_existing_export_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.local').mkdir()
            config = root / 'setup.json'
            config.write_text(json.dumps({'root': '/private', 'profile': 'fixture', 'tools': '/tools',
                'sources': {}, 'exports': {'birbcrew': '/old/crew-export', 'birbverify': '/old/verify-export'},
                'revisions': guest.PINS}))
            (root / '.local/guest-setup-path').write_text(str(config))
            for name, target in [('crew', '/old/crew-export'), ('birbcrew', '/old/crew-export'),
                                 ('verify', '/old/verify-export'), ('birbverify', '/old/verify-export')]:
                with self.subTest(name=name), patch.object(guest, 'REPO', root), \
                     patch.object(sys, 'argv', ['guest', '--producer', name, '--', 'echo', 'fixture']), \
                     patch.object(guest, 'healthy'), patch.object(guest, 'tools_ready'), \
                     patch.object(guest, 'verify_exports'), patch.object(guest.os, 'execvp') as execute:
                    guest.guest_main()
                    self.assertIn('cd ' + target + ' &&', execute.call_args.args[1][-1])


if __name__ == '__main__':
    unittest.main()
