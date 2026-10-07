"""One-time Garmin sign-in, run by Brad on his own computer.

Asks for the Garmin email, password and (if Garmin sends one) the security code, then saves
a sign-in token in his home folder. The password is never saved or shown.
"""
import getpass
import sys
from pathlib import Path

from garminconnect import Garmin

TOKEN_DIR = Path.home() / ".training-app" / "garmin"


def main() -> int:
    print("\nGarmin sign-in for the Training app")
    print("-----------------------------------")
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden as you type): ")
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    try:
        garmin = Garmin(email=email, password=password, prompt_mfa=lambda: input("Security code from Garmin (text or email): ").strip())
        garmin.login(str(TOKEN_DIR))
        name = garmin.get_full_name()
    except Exception as err:  # show the reason in plain words rather than a stack trace
        print(f"\nSign-in did not work: {type(err).__name__}: {err}")
        print("Nothing was saved. You can close this and tell Claude what it said.")
        return 1
    print(f"\nSigned in as {name}. Token saved. You can go back to the chat now.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
