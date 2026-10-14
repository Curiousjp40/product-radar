from engine.images import _guess_extension


def test_guess_extension_real_fastmoss_product_url():
    url = "https://s.500fd.com/tt_product/a4ff0ee1ad3a41ba983afbfd65fee89c~tplv-fhlh96nyum-origin-image.image"
    # no recognized extension at all here -- falls back to .jpg
    assert _guess_extension(url) == ".jpg"


def test_guess_extension_jpeg_with_crop_size_suffix_normalizes_to_jpg():
    url = "https://s.500fd.com/tt_product/24b0615da52049a68cef925f14a98d62~tplv-fhlh96nyum-resize-jpeg:800:800.jpeg"
    assert _guess_extension(url) == ".jpg"


def test_guess_extension_webp_with_crop_size_suffix():
    url = "https://s.500fd.com/tt_video/ooMRoWFeaQDLY8FAe0eAfdEjq9QNG8gOIW6udF~tplv-photomode-zoomcover:480:480.webp"
    assert _guess_extension(url) == ".webp"


def test_guess_extension_plain_png():
    assert _guess_extension("https://example.com/image.png") == ".png"


def test_guess_extension_unknown_defaults_to_jpg():
    assert _guess_extension("https://example.com/asset") == ".jpg"
