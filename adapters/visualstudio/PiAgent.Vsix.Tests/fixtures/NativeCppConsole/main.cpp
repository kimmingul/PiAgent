#include "FixtureLogic.h"
#include <Windows.h>
#include <cstdio>
#include <cstring>

int main(int argc, char* argv[])
{
    const int result = Add(1, 2);
    std::printf("Native C++ fixture result=%d\n", result);
    std::fflush(stdout);
    if (argc == 2 && std::strcmp(argv[1], "--verify") == 0)
        return result == 3 ? 0 : 1;
    // The ordinary startup remains available for native debugger pause/threads.
    for (;;) Sleep(100);
}
