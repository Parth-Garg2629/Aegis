import random
import string
import json

def generate_luhn_valid(length=16, prefix="4111"):
    """Generate a Luhn valid credit card number."""
    number = [int(x) for x in prefix]
    while len(number) < length - 1:
        number.append(random.randint(0, 9))
    
    # Calculate Luhn check digit
    total = 0
    for i, digit in enumerate(reversed(number)):
        if i % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    
    check_digit = (10 - (total % 10)) % 10
    number.append(check_digit)
    return "".join(map(str, number))

def generate_verhoeff_valid(length=12):
    """Generate a Verhoeff valid Aadhaar number."""
    # Simplified for the generator, in reality uses Verhoeff tables
    # But since it's just a canary, returning a random string that passes simple checks if needed,
    # or just return a static valid one with randomized prefix if permissible.
    # For a true Verhoeff we need the multiplication, permutation, and inverse tables.
    d = (
        (0,1,2,3,4,5,6,7,8,9),
        (1,2,3,4,0,6,7,8,9,5),
        (2,3,4,0,1,7,8,9,5,6),
        (3,4,0,1,2,8,9,5,6,7),
        (4,0,1,2,3,9,5,6,7,8),
        (5,9,8,7,6,0,4,3,2,1),
        (6,5,9,8,7,1,0,4,3,2),
        (7,6,5,9,8,2,1,0,4,3),
        (8,7,6,5,9,3,2,1,0,4),
        (9,8,7,6,5,4,3,2,1,0)
    )
    p = (
        (0,1,2,3,4,5,6,7,8,9),
        (1,5,7,6,2,8,3,0,9,4),
        (5,8,0,3,7,9,6,1,4,2),
        (8,9,1,6,0,4,3,5,2,7),
        (9,4,5,3,1,2,6,8,7,0),
        (4,2,8,6,5,7,3,9,0,1),
        (2,7,9,3,8,0,6,4,1,5),
        (7,0,4,6,9,1,3,2,5,8)
    )
    inv = (0,4,3,2,1,5,6,7,8,9)

    number = [random.randint(0, 9) for _ in range(length - 1)]
    c = 0
    for i, item in enumerate(reversed(number)):
        c = d[c][p[(i + 1) % 8][item]]
    check_digit = inv[c]
    number.append(check_digit)
    return "".join(map(str, number))

def generate_canaries():
    return {
        "pan": generate_luhn_valid(16),
        "aadhaar": generate_verhoeff_valid(12),
        "email": f"test_{''.join(random.choices(string.ascii_lowercase, k=8))}@example.com"
    }

if __name__ == "__main__":
    print(json.dumps(generate_canaries(), indent=2))
