dumpc() {
    local dir=$1
    local output="context.txt"

    > "$output"    # clear/create the file

    find "$dir" -type f | while read file; do
        echo "--- $file ---" >> "$output"
        cat "$file" >> "$output"
        echo "--/ $file ---" >> "$output"
        echo "" >> "$output"    # blank line between files
    done

    echo "Done -> $output"
}