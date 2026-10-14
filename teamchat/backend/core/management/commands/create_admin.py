import os

from django.core.management.base import BaseCommand

from core.models import AppSettings, User


class Command(BaseCommand):
    help = "Create (or reset) the admin account. Uses ADMIN_USERNAME / ADMIN_PASSWORD env vars."

    def add_arguments(self, parser):
        parser.add_argument("--if-missing", action="store_true", help="Do nothing when an admin already exists")
        parser.add_argument("--reset-password", action="store_true", help="Reset the password of an existing admin")

    def handle(self, *args, **opts):
        username = os.environ.get("ADMIN_USERNAME", "Vaibhav777")
        password = os.environ.get("ADMIN_PASSWORD", "Vaibhav@1455")
        AppSettings.get()
        existing = User.objects.filter(username__iexact=username).first()
        if existing and opts["if_missing"] and not opts["reset_password"]:
            self.stdout.write("Admin already exists - nothing to do.")
            return
        if existing:
            if opts["reset_password"]:
                existing.set_password(password)
                existing.save()
                self.stdout.write(self.style.SUCCESS(f"Password reset for admin '{existing.username}'."))
            else:
                self.stdout.write("Admin already exists. Use --reset-password to reset it.")
            return
        if opts["if_missing"] and User.objects.filter(role="admin").exists():
            self.stdout.write("An admin already exists - nothing to do.")
            return
        u = User(username=username, display_name="Admin", role="admin", is_staff=True, is_superuser=True,
                 about="Workspace administrator", using_default_password=(password == "Vaibhav@1455"))
        u.set_password(password)
        u.save()
        self.stdout.write(self.style.SUCCESS(f"Admin '{username}' created."))
        if u.using_default_password:
            self.stdout.write(self.style.WARNING("Default admin password in use - change it from Settings after signing in."))
